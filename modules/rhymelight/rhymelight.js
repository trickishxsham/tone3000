/*
 * RHYMELIGHT — IMPROVS2 rap-song comparison module with official Genius API integration
 * Build: 4.9.8.970
 * Source export: modules/rhymelight/rhymelight.json
 * Pronunciations: bundled CMU Pronouncing Dictionary (see CMUDICT-LICENSE.txt)
 * No AI or Lovable API. Optional Genius developer API uses the user's own Genius client access token.
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

  var VERSION = '4.9.8.970';
  var MAX_TRACKS = 6;
  var PALETTE = ['#F0F2D0', '#5188DE', '#FF873F', '#70D9BD', '#D65DB7', '#98E66D', '#191919', '#FFD400', '#72D0E8', '#F04443', '#00C978', '#A875C5'];
  var SECONDARY_PALETTE = ['#F6C85F', '#6EC5FF', '#F78DA7', '#8DE0A8', '#B69CFF', '#FF9F68', '#55D6C2', '#F0A6CA', '#A6C8FF', '#D7D86E', '#E89BFF', '#9DD9D2'];
  var PALETTE_NOTES = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'B', 'E', 'A', 'D', 'G'];
  var VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]$/;
  var BENCHMARKS = [
    { id: 'eminem', artist: 'Eminem', song: 'Rap God', source: 'Genius' },
    { id: 'nas', artist: 'Nas', song: 'N.Y. State of Mind', source: 'Genius' },
    { id: 'biggie', artist: 'The Notorious B.I.G.', song: 'Notorious Thugs', source: 'Genius' },
    { id: 'black-thought', artist: 'Black Thought', song: 'Hot 97 10-Minute Freestyle', source: 'Genius' },
    { id: 'rakim', artist: 'Rakim', song: 'Follow the Leader', source: 'Genius' },
    { id: '2pac', artist: '2Pac', song: 'Me Against the World', source: 'Genius' },
    { id: 'nas-the-message', artist: 'Nas', song: 'The Message', source: 'Genius' },
    { id: 'mobb-deep-shook-ones-pt-ii', artist: 'Mobb Deep', song: 'Shook Ones, Pt. II', source: 'Genius' },
    { id: 'mobb-deep-survival-of-the-fittest', artist: 'Mobb Deep', song: 'Survival of the Fittest', source: 'Genius' },
    { id: 'rakim-know-the-ledge', artist: 'Eric B. & Rakim', song: 'Know the Ledge', source: 'Genius' },
    { id: 'eminem-the-way-i-am', artist: 'Eminem', song: 'The Way I Am', source: 'Genius' },
    { id: 'eminem-godzilla', artist: 'Eminem', song: 'Godzilla', source: 'Genius' },
    { id: 'eminem-forever', artist: 'Drake feat. Kanye West, Lil Wayne & Eminem', song: 'Forever', source: 'Genius' },
    { id: 'biggie-kick-in-the-door', artist: 'The Notorious B.I.G.', song: 'Kick in the Door', source: 'Genius' },
    { id: '2pac-hail-mary', artist: '2Pac', song: 'Hail Mary', source: 'Genius' },
    { id: '2pac-trapped', artist: '2Pac', song: 'Trapped', source: 'Genius' },
    { id: 'black-thought-zen-approach', artist: 'DJ Krush feat. Black Thought', song: 'Zen Approach', source: 'Genius' }
  ];
  var state = {
    root: null, panel: null, mounted: false, open: false, initialisedWithConfig: false, tracks: [], results: null,
    dictionary: null, dictionaryPromise: null, config: null, configPromise: null, seedLibrary: [], library: [], view: 'syllables', focus: null, status: '', geniusToken: '', geniusQuery: ''
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
  function getPalette() { return (getConfig().palette || PALETTE).concat(getConfig().secondaryPalette || SECONDARY_PALETTE); }
  function paletteTextColor(color) { return String(color || '').toLowerCase() === '#191919' ? '#FFFFFF' : '#000000'; }
  function primaryPaletteNotes() { return (getConfig().paletteNotes || PALETTE_NOTES).slice(); }
  function paletteNote(index) { return index < primaryPaletteNotes().length ? primaryPaletteNotes()[index] : 'SECONDARY ' + (index - primaryPaletteNotes().length + 1); }
  function getBenchmarks() { return getConfig().benchmarks || BENCHMARKS; }
  function getMaxTracks() { return getConfig().maxTracks || MAX_TRACKS; }

  function loadConfig(root) {
    if (state.config) return Promise.resolve(state.config);
    if (state.configPromise) return state.configPromise;
    state.configPromise = (async function () {
      var configPath = 'modules/rhymelight/rhymelight.json?v=' + encodeURIComponent(VERSION);
      var url = typeof root.__rootRelative === 'function' ? root.__rootRelative(configPath) : configPath;
      var response = await root.fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Local rhymelight.json configuration could not be loaded (' + response.status + ').');
      var config = await response.json();
      if (!config || config.module !== 'rhymelight' || config.mode !== 'local-analysis-genius-api' || !Array.isArray(config.benchmarks) || !Array.isArray(config.palette) || !Array.isArray(config.secondaryPalette) || config.paletteOrder !== 'ascending-fourths' || !Array.isArray(config.paletteNotes) || !config.processing || config.processing.ai !== false || config.processing.lovable !== false || config.processing.api !== true || config.processing.apiProvider !== 'Genius only' || config.processing.speechRecognition !== false || config.processing.audioUpload !== false || config.processing.remoteServices !== false || !config.genius || config.genius.apiBase !== 'https://api.genius.com' || config.genius.auth !== 'client_access_token' || !config.pronunciation || config.pronunciation.file !== 'rhymelight-pronunciations.json') throw new Error('rhymelight.json is not a valid Rhymelight/Genius API configuration.');
      if (!Array.isArray(config.starterLibrary) || !config.starterLibrary.some(function (song) { return song.id === 'benchmark-rap-god' && /Rap God/.test(song.lyrics || ''); })) throw new Error('The local starter lyric library is missing the supplied Rap God entry.');
      state.config = config;
      state.seedLibrary = config.starterLibrary.slice();
      hydrateLibrary(root);
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

  function optionalNumber(value, min, max) {
    if (value === '' || value === null || value === undefined) return null;
    var number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(min, Math.min(max, number));
  }

  function parseTrack(track, dictionary) {
    var sourceLines = String(track.lyrics || '').replace(/\r/g, '').split('\n');
    var lines = sourceLines.map(function (line, sourceIndex) {
      var words = line.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
      return { sourceIndex: sourceIndex, words: words.map(function (word) { return parseWord(word, dictionary); }) };
    }).filter(function (line) { return line.words.length > 0; });
    return {
      id: String(track.id), name: String(track.name || 'Untitled track'), sourceLines: sourceLines,
      bpm: optionalNumber(track.bpm, 40, 240), durationSeconds: optionalNumber(track.durationSeconds, 0.5, 3600),
      wordplayScore: optionalNumber(track.wordplayScore, 0, 10),
      imageryScore: optionalNumber(track.imageryScore, 0, 10),
      technicalWitScore: optionalNumber(track.technicalWitScore, 0, 10),
      lines: lines.map(function (line) {
        var last = line.words.length ? line.words[line.words.length - 1] : null;
        return { sourceIndex: line.sourceIndex, group: last ? last.group : null, words: line.words };
      })
    };
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

  function calculateSustainedComplexity(analysis) {
    var lines = analysis.lines || [], windows = 0, sustained = 0;
    for (var start = 0; start < lines.length; start += 4) {
      var block = lines.slice(start, start + 4), sounds = new Map();
      windows++;
      block.forEach(function (line) {
        (line.words || []).forEach(function (word) {
          (word.syllables || []).forEach(function (syllable) {
            if (!syllable.group) return;
            if (!sounds.has(syllable.group)) sounds.set(syllable.group, new Set());
            sounds.get(syllable.group).add(normaliseWord(word.text));
          });
        });
      });
      if (Array.from(sounds.values()).some(function (forms) { return forms.size >= 2; })) sustained++;
    }
    return windows ? (sustained / windows) * 100 : 0;
  }

  function calculateLineLengthVariation(analysis) {
    var counts = (analysis.lines || []).map(function (line) {
      return (line.words || []).reduce(function (sum, word) { return sum + (word.syllables || []).length; }, 0);
    }).filter(function (n) { return n > 0; });
    if (counts.length < 2) return 0;
    var mean = counts.reduce(function (sum, n) { return sum + n; }, 0) / counts.length;
    if (!mean) return 0;
    var variance = counts.reduce(function (sum, n) { return sum + Math.pow(n - mean, 2); }, 0) / counts.length;
    return Math.sqrt(variance) / mean;
  }

  function calculateFlowScore(analysis, syllables, stressVariation) {
    var bpm = analysis.bpm, duration = analysis.durationSeconds;
    var stressScore = clampScore((stressVariation / 0.45) * 100);
    var lineVariationScore = clampScore((calculateLineLengthVariation(analysis) / 0.45) * 100);
    if (duration && duration > 0) {
      var syllablesPerSecond = syllables / duration;
      var paceScore = clampScore((syllablesPerSecond / 10) * 100);
      if (bpm && bpm > 0) {
        var syllablesPerBeat = syllablesPerSecond / (bpm / 60);
        var beatDensityScore = clampScore((syllablesPerBeat / 3) * 100);
        return {
          score: Math.round((paceScore * 0.45 + beatDensityScore * 0.35 + stressScore * 0.20) * 10) / 10,
          measured: true, syllablesPerSecond: syllablesPerSecond, syllablesPerBeat: syllablesPerBeat,
          method: 'Timed delivery: 45% syllables/second, 35% syllables/beat, 20% stress variation'
        };
      }
      return {
        score: Math.round((paceScore * 0.65 + stressScore * 0.35) * 10) / 10,
        measured: true, syllablesPerSecond: syllablesPerSecond, syllablesPerBeat: null,
        method: 'Timed delivery: 65% syllables/second, 35% stress variation; BPM not supplied'
      };
    }
    return {
      score: Math.round((stressScore * 0.55 + lineVariationScore * 0.45) * 10) / 10,
      measured: false, syllablesPerSecond: null, syllablesPerBeat: null,
      method: 'Text-only rhythm proxy: stress variation and syllable-count variation; delivery speed not measured'
    };
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
        (word.syllables || []).forEach(function (syllable, si) {
          totalSyllables++;
          if (syllable.group && localRhymeGroups.has(syllable.group)) {
            rhymed++;
            seenSounds.add(syllable.group);
            if (wi < words.length - 1 || si < word.syllables.length - 1) internal++;
          }
          if (syllable.group && groupTracks.has(syllable.group)) {
            var tracksForSound = groupTracks.get(syllable.group);
            if (tracksForSound && tracksForSound.size > 1) sharedSounds.add(syllable.group);
          }
        });
      });
    });
    var stressVariation = calculateTrackStressVariation(analysis);
    var flow = calculateFlowScore(analysis, totalSyllables, stressVariation);
    var metrics = {
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
      totalWords: totalWords,
      stressVariation: stressVariation,
      bpm: analysis.bpm,
      durationSeconds: analysis.durationSeconds,
      deliveryMeasured: flow.measured,
      syllablesPerSecond: flow.syllablesPerSecond,
      syllablesPerBeat: flow.syllablesPerBeat,
      flowScore: flow.score,
      flowMethod: flow.method,
      sustainedComplexity: calculateSustainedComplexity(analysis),
      wordplayScore: analysis.wordplayScore,
      imageryScore: analysis.imageryScore,
      technicalWitScore: analysis.technicalWitScore
    };
    metrics.complexityGrade = calculateComplexityGrade(metrics);
    return metrics;
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
    var eligible = new Set();
    ['syllables', 'words', 'lines'].forEach(function (view) {
      tally(analyses || [], view).forEach(function (_, id) { eligible.add(id); });
    });
    var add = function (id) { if (id && eligible.has(id) && !map.has(id)) map.set(id, map.size % getPalette().length); };
    (analyses || []).forEach(function (analysis) { analysis.lines.forEach(function (line) {
      line.words.forEach(function (word) { word.syllables.forEach(function (s) { add(s.group); }); add(word.group); });
    }); });
    (analyses || []).forEach(function (analysis) { analysis.lines.forEach(function (line) { add(line.group); }); });
    return map;
  }

  function clampScore(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

  function calculateComplexityGrade(metrics) {
    metrics = metrics || {};
    var lines = Math.max(0, Number(metrics.lines) || 0);
    var syllables = Math.max(0, Number(metrics.syllables) || 0);
    var multiPer16 = lines ? (Math.max(0, Number(metrics.multiRhymes) || 0) / lines) * 16 : 0;
    var internalPer100 = syllables ? (Math.max(0, Number(metrics.internalRhymes) || 0) / syllables) * 100 : 0;
    var flowFallback = clampScore(((Number(metrics.stressVariation) || 0) / 0.45) * 100);
    var components = [
      { id: 'multiRhymes', label: 'Multisyllabic rhyming', weight: 20, score: clampScore((multiPer16 / 6) * 100), benchmark: '6 distinct repeated multisyllabic patterns per 16 lines = 100' },
      { id: 'internalRhymes', label: 'Internal rhyme density', weight: 15, score: clampScore((internalPer100 / 20) * 100), benchmark: '20 internal-rhyme syllables per 100 syllables = 100' },
      { id: 'rhymeDensity', label: 'Rhyme density', weight: 10, score: clampScore(((Number(metrics.rhymeDensity) || 0) / 0.4) * 100), benchmark: '40% repeated rhyme-syllable density = 100' },
      { id: 'flow', label: 'Flow & rhythmic complexity', weight: 15, score: clampScore(metrics.flowScore === undefined ? flowFallback : metrics.flowScore), benchmark: 'Delivery pace, beat density and stress variation; text-only proxy when timing is absent' },
      { id: 'wordplay', label: 'Wordplay & double meanings', weight: 15, score: optionalNumber(metrics.wordplayScore, 0, 10) === null ? null : Number(metrics.wordplayScore) * 10, benchmark: 'Manual assessment from 0–10; local engine does not infer semantic double meanings' },
      { id: 'imagery', label: 'Metaphor & imagery', weight: 10, score: optionalNumber(metrics.imageryScore, 0, 10) === null ? null : Number(metrics.imageryScore) * 10, benchmark: 'Manual assessment from 0–10; imagery is not guessed by phonetic analysis' },
      { id: 'technicalWit', label: 'Technical vocabulary & wit', weight: 10, score: optionalNumber(metrics.technicalWitScore, 0, 10) === null ? null : Number(metrics.technicalWitScore) * 10, benchmark: 'Manual assessment from 0–10' },
      { id: 'sustained', label: 'Sustained complexity', weight: 5, score: clampScore(metrics.sustainedComplexity || 0), benchmark: 'Share of four-line blocks containing a recurring phonetic rhyme family' }
    ];
    var missing = components.filter(function (component) { return component.score === null; }).map(function (component) { return component.id; });
    var activeWeight = components.reduce(function (sum, component) { return sum + (component.score === null ? 0 : component.weight); }, 0);
    components.forEach(function (component) {
      component.points = component.score === null ? 0 : Math.round(component.score * component.weight) / 100;
    });
    var earned = components.reduce(function (sum, component) { return sum + component.points; }, 0);
    return {
      total: activeWeight ? Math.round((earned / activeWeight) * 100) : 0,
      components: components,
      scales: { multiPer16: multiPer16, internalPer100: internalPer100 },
      complete: missing.length === 0,
      missing: missing,
      activeWeight: activeWeight,
      method: 'Weighted technical analysis plus manually supplied artistry ratings. Missing semantic ratings are excluded and the grade is provisional until supplied.'
    };
  }

  function geniusSearchUrl(query) {
    return 'https://genius.com/search?q=' + encodeURIComponent(String(query || '').trim());
  }

  function geniusApiUrl(endpoint, params) {
    var allowed = endpoint === 'search' || endpoint === 'referents' || /^songs\/\d+$/.test(String(endpoint || ''));
    if (!allowed) throw new Error('Unsupported Genius API endpoint.');
    var query = [];
    Object.keys(params || {}).forEach(function (key) {
      if (params[key] === undefined || params[key] === null || params[key] === '') return;
      query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return 'https://api.genius.com/' + endpoint + (query.length ? '?' + query.join('&') : '');
  }

  function parseGeniusSearch(payload) {
    var hits = payload && payload.response && Array.isArray(payload.response.hits) ? payload.response.hits : [];
    return hits.map(function (hit) { return hit && hit.result; }).filter(function (song) {
      return song && Number.isFinite(Number(song.id)) && typeof song.url === 'string' && /^https:\/\/genius\.com\//i.test(song.url);
    }).map(function (song) {
      return { id: Number(song.id), title: song.full_title || song.title || 'Genius song', artist: song.primary_artist && song.primary_artist.name || '', url: song.url, annotationCount: Number(song.annotation_count) || 0 };
    });
  }

  function parseGeniusSongDetails(payload) {
    var song = payload && payload.response && payload.response.song;
    if (!song || !Number.isFinite(Number(song.id))) return null;
    var url = String(song.url || '');
    if (!validGeniusPageUrl(url)) return null;
    return {
      id: Number(song.id),
      title: String(song.full_title || song.title || 'Genius song'),
      url: url,
      embedContent: String(song.embed_content || '')
    };
  }

  function geniusEmbedDocument(song) {
    if (!song || !Number.isFinite(Number(song.id)) || !validGeniusPageUrl(song.url)) throw new Error('Genius song details are invalid; cannot build the in-app embed.');
    var id = Math.floor(Number(song.id));
    var title = escapeHTML(song.title || 'Genius song');
    var url = escapeHTML(song.url);
    // This is Genius's published song embed endpoint, placed in a script-only sandboxed frame.
    // The app does not read, copy, or scrape the lyrics from the embed.
    return '<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.5 Arial,sans-serif}body{padding:8px}.rg_embed_link{min-height:48px}</style></head><body><div id=\"rg_embed_link_' + id + '\" class=\"rg_embed_link\" data-song-id=\"' + id + '\">Read <a href=\"' + url + '\">' + title + '</a> on Genius</div><script crossorigin src=\"https://genius.com/songs/' + id + '/embed.js\"><\/script></body></html>';
  }

  function parseGeniusReferents(payload) {
    var referents = payload && payload.response && Array.isArray(payload.response.referents) ? payload.response.referents : [];
    return referents.map(function (referent) {
      var annotations = Array.isArray(referent.annotations) ? referent.annotations : [];
      return {
        fragment: String(referent.fragment || ''), classification: String(referent.classification || ''), url: String(referent.url || ''),
        annotations: annotations.map(function (annotation) {
          var body = annotation.body;
          var plain = body && (body.plain || body.markdown || body.html) || '';
          var authors = Array.isArray(annotation.authors) ? annotation.authors : [];
          var author = authors.map(function (entry) { return entry && entry.user && (entry.user.name || entry.user.login); }).filter(Boolean)[0] || '';
          return { id: Number(annotation.id) || 0, body: String(plain), verified: !!annotation.verified, state: String(annotation.state || ''), url: String(annotation.url || referent.url || ''), votes: Number(annotation.votes_total) || 0, author: String(author) };
        }).filter(function (annotation) { return !!annotation.body; })
      };
    }).filter(function (referent) { return referent.fragment && referent.annotations.length; });
  }

  async function geniusApiRequest(root, endpoint, params, tokenOverride) {
    var token = String(tokenOverride === undefined ? state.geniusToken || '' : tokenOverride || '').trim();
    if (!token) throw new Error('Add your Genius Client Access Token in the Genius settings above, then save it on this device.');
    var url = geniusApiUrl(endpoint, params);
    var headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    var cap = root && root.Capacitor;
    var nativeHttp = root && (root.CapacitorHttp || (cap && cap.Plugins && cap.Plugins.CapacitorHttp));
    if (nativeHttp && typeof nativeHttp.get === 'function') {
      var nativeResponse = await nativeHttp.get({ url: url, headers: headers, responseType: 'json' });
      var nativeStatus = Number(nativeResponse && nativeResponse.status) || 0;
      if (nativeStatus && (nativeStatus < 200 || nativeStatus >= 300)) throw new Error('Genius API returned HTTP ' + nativeStatus + '. Check the token and Genius API access.');
      var nativeData = nativeResponse && nativeResponse.data;
      if (typeof nativeData === 'string') { try { nativeData = JSON.parse(nativeData); } catch (err) { throw new Error('Genius returned an unreadable response.'); } }
      return nativeData;
    }
    if (!root || typeof root.fetch !== 'function') throw new Error('This app has no HTTP request provider available for Genius API access.');
    var response;
    try { response = await root.fetch(url, { method: 'GET', headers: headers, cache: 'no-store' }); }
    catch (err) { throw new Error('Could not reach the Genius API from this browser context. On the Capacitor build, enable the CapacitorHttp native plugin; browser CORS may block direct API requests.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Genius rejected the token or API request (HTTP ' + response.status + '). Check your Client Access Token.');
      throw new Error('Genius API returned HTTP ' + response.status + '.');
    }
    return response.json();
  }

  function validGeniusPageUrl(url) { return /^https:\/\/genius\.com\//i.test(String(url || '')); }

  function renderGeniusSongs(songs) {
    var host = state.panel && state.panel.querySelector('[data-rl-genius-api-results]');
    if (!host) return;
    if (!songs.length) { host.innerHTML = '<div class=\"rl-muted\">No Genius song matches were returned.</div>'; return; }
    host.innerHTML = '<div class=\"rl-genius-api-title\">GENIUS API SEARCH RESULTS</div>' + songs.slice(0, 8).map(function (song) {
      return '<button type=\"button\" class=\"rl-genius-song-result\" data-rl-genius-song-id=\"' + song.id + '\" data-rl-genius-song-url=\"' + escapeHTML(song.url) + '\" data-rl-genius-song-title=\"' + escapeHTML(song.title) + '\"><strong>' + escapeHTML(song.title) + '</strong><span>' + escapeHTML(song.artist) + ' · ' + song.annotationCount + ' annotations</span></button>';
    }).join('');
  }

  function renderGeniusAnnotations(referents) {
    var host = state.panel && state.panel.querySelector('[data-rl-genius-api-results]');
    if (!host) return;
    if (!referents.length) { host.innerHTML = '<div class=\"rl-muted\">Genius returned no annotated lyric fragments for this song.</div>'; return; }
    host.innerHTML = '<div class=\"rl-genius-api-title\">LYRIC FRAGMENTS & GENIUS EXPLANATIONS</div>' + referents.map(function (referent) {
      return '<article class=\"rl-genius-annotation\"><div class=\"rl-genius-fragment\">' + escapeHTML(referent.fragment) + '</div>' + referent.annotations.map(function (annotation) {
        return '<div class=\"rl-genius-explanation\"><div class=\"rl-genius-meta\">' + (annotation.verified ? '<b class=\"rl-genius-verified\">VERIFIED</b>' : '<b>COMMUNITY</b>') + (annotation.author ? ' · ' + escapeHTML(annotation.author) : '') + (annotation.votes ? ' · ' + annotation.votes + ' votes' : '') + '</div><div>' + escapeHTML(annotation.body).replace(/\n/g, '<br>') + '</div>' + (validGeniusPageUrl(annotation.url) ? '<button type=\"button\" class=\"rl-quiet\" data-rl-genius-open-url=\"' + escapeHTML(annotation.url) + '\">VIEW ON GENIUS</button>' : '') + '</div>';
      }).join('') + '</article>';
    }).join('');
  }

  async function searchGeniusInApp(query) {
    state.geniusQuery = String(query || '').trim();
    var panel = state.panel && state.panel.querySelector('[data-rl-genius-panel]');
    var results = state.panel && state.panel.querySelector('[data-rl-genius-api-results]');
    var frame = state.panel && state.panel.querySelector('[data-rl-genius-frame]');
    if (panel) { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    if (results) results.innerHTML = '<div class=\"rl-muted\">Searching Genius…</div>';
    try {
      var payload = await geniusApiRequest(state.root, 'search', { q: state.geniusQuery });
      var songs = parseGeniusSearch(payload);
      renderGeniusSongs(songs);
      if (songs.length === 1) await selectGeniusSong(songs[0].id, songs[0].url, songs[0].title);
      else if (!songs.length && results) results.innerHTML = '<div class=\"rl-muted\">No matching Genius songs found.</div>';
      // Do not assign frame.src here: selectGeniusSong() installs the official Genius embed via srcdoc.
    } catch (err) {
      if (results) results.innerHTML = '<div class=\"rl-genius-error\">' + escapeHTML(err.message || 'Genius API request failed.') + '</div>';
      updateStatus(err.message || 'Genius API request failed.', 'error');
    }
  }

  async function selectGeniusSong(songId, songUrl, title) {
    var results = state.panel && state.panel.querySelector('[data-rl-genius-api-results]');
    var frame = state.panel && state.panel.querySelector('[data-rl-genius-frame]');
    if (results) results.innerHTML = '<div class=\"rl-muted\">Loading Genius lyrics embed and annotations for ' + escapeHTML(title || 'song') + '…</div>';
    var detailRequest = geniusApiRequest(state.root, 'songs/' + Math.floor(Number(songId)), { text_format: 'plain' });
    var referentRequest = geniusApiRequest(state.root, 'referents', { song_id: songId, per_page: 50, text_format: 'plain' });
    var detailResult = await detailRequest.then(parseGeniusSongDetails).catch(function () { return null; });
    if (frame) {
      var embedSong = detailResult || { id: Number(songId), title: title || 'Genius song', url: songUrl };
      if (validGeniusPageUrl(embedSong.url)) {
        frame.removeAttribute('src');
        frame.srcdoc = geniusEmbedDocument(embedSong);
      }
    }
    try {
      var payload = await referentRequest;
      renderGeniusAnnotations(parseGeniusReferents(payload));
    } catch (err) {
      if (results) results.innerHTML = '<div class=\"rl-genius-error\">' + escapeHTML(err.message || 'Could not load Genius annotations.') + '</div>';
    }
  }

  function buildColorCounts(analyses, colors) {
    var records = new Map();
    function record(id) {
      if (!id) return null;
      if (!records.has(id)) records.set(id, { id: id, syllables: 0, words: 0, lines: 0, uniqueWords: new Set(), tracks: new Set() });
      return records.get(id);
    }
    (analyses || []).forEach(function (analysis) {
      (analysis.lines || []).forEach(function (line) {
        var lineGroups = new Set();
        (line.words || []).forEach(function (word) {
          var wordGroups = new Set();
          (word.syllables || []).forEach(function (syllable) {
            if (!syllable.group) return;
            var entry = record(syllable.group);
            entry.syllables++;
            entry.uniqueWords.add(normaliseWord(word.text));
            entry.tracks.add(analysis.id);
            wordGroups.add(syllable.group);
            lineGroups.add(syllable.group);
          });
          wordGroups.forEach(function (id) { record(id).words++; });
        });
        lineGroups.forEach(function (id) { record(id).lines++; });
      });
    });
    return Array.from(records.values()).filter(function (entry) { return entry.uniqueWords.size >= 2; }).map(function (entry) {
      var index = colors && colors.has(entry.id) ? colors.get(entry.id) : 0;
      var color = getPalette()[index % getPalette().length];
      return {
        id: entry.id, index: index, note: paletteNote(index), color: color,
        textColor: paletteTextColor(color), sound: soundLabel(entry.id.slice(2).replace(/_/g, ' ')),
        syllables: entry.syllables, words: entry.words, lines: entry.lines,
        uniqueWords: entry.uniqueWords.size, tracks: entry.tracks.size
      };
    }).sort(function (a, b) { return a.index - b.index; });
  }

  function upsertLibrarySong(existing, input) {
    var list = Array.isArray(existing) ? existing.slice() : [];
    input = input || {};
    var name = String(input.name || '').trim();
    var lyrics = String(input.lyrics || '');
    if (!name) throw new Error('Song name is required.');
    if (!lyrics.trim()) throw new Error('Lyrics are required before saving.');
    if (lyrics.length > 50000) throw new Error('A saved song cannot exceed 50,000 characters.');
    var id = String(input.id || ('song-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)));
    var previous = list.find(function (song) { return song.id === id; });
    var song = {
      id: id, name: name, artist: String(input.artist || '').trim(), lyrics: lyrics,
      source: String(input.source || '').trim(), isBuiltin: !!input.isBuiltin,
      bpm: optionalNumber(input.bpm, 40, 240), durationSeconds: optionalNumber(input.durationSeconds, 0.5, 3600),
      wordplayScore: optionalNumber(input.wordplayScore, 0, 10),
      imageryScore: optionalNumber(input.imageryScore, 0, 10),
      technicalWitScore: optionalNumber(input.technicalWitScore, 0, 10),
      createdAt: previous && previous.createdAt || input.createdAt || Date.now(), updatedAt: Date.now()
    };
    var index = list.findIndex(function (item) { return item.id === id; });
    if (index >= 0) list[index] = song; else list.push(song);
    return list;
  }

  function deleteLibrarySong(existing, id) {
    return (Array.isArray(existing) ? existing : []).filter(function (song) { return song.id !== String(id) || song.isBuiltin; });
  }

  function calculateTrackStressVariation(analysis) {
    var switches = 0, pairs = 0;
    (analysis.lines || []).forEach(function (line) {
      var stress = [];
      (line.words || []).forEach(function (word) { (word.syllables || []).forEach(function (syllable) { stress.push(!!syllable.stressed); }); });
      for (var i = 1; i < stress.length; i++) { pairs++; if (stress[i] !== stress[i - 1]) switches++; }
    });
    return pairs ? switches / pairs : 0;
  }

  function makeImagePdf(jpegBytes, imageWidth, imageHeight) {
    var pageW = 595, pageH = 842, margin = 27, drawW = pageW - margin * 2;
    var drawH = imageHeight * drawW / imageWidth;
    var pages = Math.max(1, Math.ceil(drawH / pageH));
    var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    function ascii(value) { return encoder ? encoder.encode(value) : Uint8Array.from(value, function (c) { return c.charCodeAt(0) & 255; }); }
    function join(parts) {
      var length = parts.reduce(function (sum, part) { return sum + part.length; }, 0), out = new Uint8Array(length), offset = 0;
      parts.forEach(function (part) { out.set(part, offset); offset += part.length; });
      return out;
    }
    var objects = [];
    objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>');
    var imageObjectId = 3 + (pages * 2);
    objects[imageObjectId] = join([ascii('<< /Type /XObject /Subtype /Image /Width ' + imageWidth + ' /Height ' + imageHeight + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n'), jpegBytes, ascii('\nendstream')]);
    var kids = [];
    for (var i = 0; i < pages; i++) {
      var pageId = 3 + i * 2, contentId = pageId + 1;
      kids.push(pageId + ' 0 R');
      objects[pageId] = ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 ' + imageObjectId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>');
      var y = pageH - margin - drawH - (i * pageH);
      var content = 'q\n' + drawW + ' 0 0 ' + drawH.toFixed(3) + ' ' + margin + ' ' + y.toFixed(3) + ' cm\n/Im0 Do\nQ';
      var contentBytes = ascii(content);
      objects[contentId] = join([ascii('<< /Length ' + contentBytes.length + ' >>\nstream\n'), contentBytes, ascii('\nendstream')]);
    }
    objects[2] = ascii('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>');
    var maxId = imageObjectId, chunks = [ascii('%PDF-1.4\n')], offsets = [0], position = chunks[0].length;
    for (var id = 1; id <= maxId; id++) {
      offsets[id] = position;
      var start = ascii(id + ' 0 obj\n'), end = ascii('\nendobj\n');
      chunks.push(start, objects[id], end); position += start.length + objects[id].length + end.length;
    }
    var xrefOffset = position;
    var xref = 'xref\n0 ' + (maxId + 1) + '\n0000000000 65535 f \n';
    for (var oi = 1; oi <= maxId; oi++) xref += String(offsets[oi]).padStart(10, '0') + ' 00000 n \n';
    chunks.push(ascii(xref + 'trailer\n<< /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF'));
    return join(chunks);
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

  var LIBRARY_STORAGE_KEY = 'improvs2.rhymelight.library.v1';

  function hydrateLibrary(root) {
    var saved = [];
    try {
      var raw = root.localStorage && root.localStorage.getItem(LIBRARY_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) saved = parsed.filter(function (song) { return song && typeof song.id === 'string' && typeof song.name === 'string' && typeof song.lyrics === 'string'; });
      }
    } catch (err) { saved = []; }
    state.library = saved;
    (state.seedLibrary || []).forEach(function (seed) {
      if (!state.library.some(function (song) { return song.id === seed.id; })) state.library = upsertLibrarySong(state.library, seed);
    });
    persistLibrary(root);
  }

  function persistLibrary(root) {
    try {
      if (!root.localStorage) return false;
      root.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state.library));
      return true;
    } catch (err) {
      updateStatus('This browser could not save the song library. Check local storage permissions or available space.', 'warn');
      return false;
    }
  }

  function findLibrarySong(id) {
    return state.library.find(function (song) { return song.id === String(id); }) || null;
  }

  function renderLibraryControls() {
    var select = state.panel && state.panel.querySelector('[data-rl-library-select]');
    if (!select) return;
    var selected = select.value;
    select.innerHTML = '<option value="">Choose a saved song…</option>' + state.library.map(function (song) {
      return '<option value="' + escapeHTML(song.id) + '">' + escapeHTML(song.name) + (song.isBuiltin ? ' · BUILT-IN' : '') + '</option>';
    }).join('');
    if (state.library.some(function (song) { return song.id === selected; })) select.value = selected;
    var count = state.panel.querySelector('[data-rl-library-count]');
    if (count) count.textContent = state.library.length + ' SONGS STORED ON THIS DEVICE';
    var del = state.panel.querySelector('[data-rl-library-delete]');
    if (del) {
      var selectedSong = findLibrarySong(select.value);
      del.disabled = !selectedSong || selectedSong.isBuiltin;
      del.textContent = selectedSong && selectedSong.isBuiltin ? 'BUILT-IN' : 'DELETE SELECTED';
    }
  }

  function initialTracks() {
    var rapGod = (state.seedLibrary || []).find(function (song) { return song.id === 'benchmark-rap-god'; });
    return [
      { id: 'track-1', preset: 'eminem', libraryId: 'benchmark-rap-god', name: 'Eminem — Rap God', lyrics: rapGod ? rapGod.lyrics : '' },
      { id: 'track-2', preset: getBenchmarks()[1].id, name: getBenchmarks()[1].artist + ' — ' + getBenchmarks()[1].song, lyrics: '' }
    ];
  }

  function optionsMarkup(selected) {
    var options = '<option value="custom"' + (selected === 'custom' ? ' selected' : '') + '>Custom track</option>' + getBenchmarks().map(function (b) {
      return '<option value="' + b.id + '"' + (selected === b.id ? ' selected' : '') + '>' + escapeHTML(b.artist + ' — ' + b.song + (b.referenceTier === 'elite' ? ' · ELITE' : '') + (b.source ? ' · GENIUS' : '')) + '</option>';
    }).join('');
    if (state.library.length) options += '<optgroup label="MY SAVED SONGS">' + state.library.map(function (song) {
      var value = 'library:' + song.id;
      return '<option value="' + escapeHTML(value) + '"' + (selected === value ? ' selected' : '') + '>' + escapeHTML(song.name) + '</option>';
    }).join('') + '</optgroup>';
    return options;
  }

  function panelMarkup() {
    return '<div class="rl-head"><div><div class="rl-wordmark">RHYME<span style="color:#7897bd">·</span>LIGHT</div><div class="rl-sub">RAP SONG COMPLEXITY COMPARISON · BUILD 969</div></div><button type="button" class="rl-quiet" data-rl-close>✕ CLOSE</button></div>' +
      '<p class="rl-intro">Compare the rhyme architecture of great rap passages. The same phonetic sound gets the same colour across every song — syllable by syllable, word by word and line by line.</p>' +
      '<div class="rl-local"><span class="rl-local-dot"></span>LOCAL LYRIC ANALYSIS <span>·</span> NO AI <span>·</span> GENIUS DEVELOPER API WHEN ENABLED</div>' +
      '<div class="rl-sheet"><div class="rl-row rl-sectionhead"><strong>MY SONG LIBRARY</strong><span class="rl-muted" data-rl-library-count>0 SONGS STORED ON THIS DEVICE</span></div><div class="rl-library-row"><select data-rl-library-select aria-label="Saved songs"><option value="">Choose a saved song…</option></select><button type="button" class="rl-quiet" data-rl-library-add>＋ ADD</button><button type="button" class="rl-quiet" data-rl-library-delete disabled>DELETE SELECTED</button></div><div class="rl-muted">Saved locally in this browser/device. No cloud account or upload.</div></div>' +
      '<div class="rl-sheet"><div class="rl-row rl-sectionhead"><strong>CHOOSE YOUR TRACKS</strong><span class="rl-muted">2–6 SONGS</span></div>' +
      '<div data-rl-track-editors></div>' +
      '<div class="rl-row rl-actions"><button type="button" class="rl-quiet" data-rl-add>＋ ADD SONG</button><button type="button" class="rl-primary" data-rl-compare>COMPARE RHYMES</button></div>' +
      '<section class="rl-genius-preview" data-rl-genius-panel hidden><div class="rl-row rl-genius-preview-head"><strong>GENIUS · IN-APP LYRICS & ANNOTATIONS</strong><button type="button" class="rl-quiet" data-rl-genius-close>✕ CLOSE</button></div><div class="rl-genius-settings"><label>GENIUS CLIENT ACCESS TOKEN<input type="password" data-rl-genius-token autocomplete="off" placeholder="Paste your Genius client access token"></label><div class="rl-row"><button type="button" class="rl-quiet" data-rl-genius-token-save>USE / SAVE TOKEN</button><button type="button" class="rl-quiet" data-rl-genius-token-clear>CLEAR TOKEN</button><span class="rl-muted" data-rl-genius-token-state></span></div><div class="rl-muted">Create a Client Access Token at genius.com/api-clients. It is stored only on this device. Rhymelight calls api.genius.com directly, not Lovable.</div></div><div data-rl-genius-api-results></div><iframe data-rl-genius-frame title="Genius song lyrics preview inside Rhymelight" sandbox="allow-scripts" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="rl-muted">The official API supplies annotated lyric fragments and explanations. Full lyrics are rendered by Genius’s own song embed script inside this isolated in-app preview; no lyrics are scraped or copied into Rhymelight.</div></section>' +
      '<div class="rl-status" data-rl-status hidden></div></div>' +
      '<div data-rl-results></div>' +
      '<div class="rl-note">Rap God is preloaded from the lyrics you supplied. Benchmark entries are elite reference titles, not fabricated fixed scores; each grade is calculated from the actual passage entered. Enter BPM and the exact passage duration to measure delivery pace and syllables per beat. Rate wordplay, imagery and technical wit yourself (0–10); those semantic dimensions cannot be reliably inferred by the phonetic analyser. Use the official Genius API for song matching and annotations, with your own Genius Client Access Token. The full song page is also presented in the in-app preview when Genius permits embedding. Rhymelight does not use Lovable APIs or scrape Genius lyrics. Save your own verses or imported passages to this device library. JPEG and PDF exports include the new metrics.</div>'; 
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
    '#rhymelightPanel .rl-track-top{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px;align-items:center}',
    '#rhymelightPanel input,#rhymelightPanel select,#rhymelightPanel textarea{width:100%;min-width:0;background:#080f18;border:1px solid #34465d;border-radius:5px;color:#e8eef7;padding:8px;outline:none}',
    '#rhymelightPanel textarea{resize:vertical;min-height:104px;margin-top:7px;line-height:1.6;font-family:ui-monospace,monospace;font-size:12px}',
    '#rhymelightPanel .rl-track-name{margin-top:7px}',
    '#rhymelightPanel .rl-meta-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:7px}',
    '#rhymelightPanel .rl-meta-field{min-width:0;color:#91a2b8;font-size:8px;font-weight:800;letter-spacing:.3px}',
    '#rhymelightPanel .rl-meta-field input{margin-top:3px;padding:6px;font-size:11px}',
    '#rhymelightPanel .rl-editor-help{margin-top:5px;color:#8598af;font-size:9px}',
    '#rhymelightPanel .rl-actions{justify-content:space-between;margin-top:10px}',
    '#rhymelightPanel .rl-library-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;margin:8px 0}',
    '#rhymelightPanel .rl-save-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}',
    '#rhymelightPanel .rl-grade{display:flex;gap:10px;align-items:center;padding:9px;margin:0 8px 8px;background:#172538;border:1px solid #34465d;border-radius:6px}',
    '#rhymelightPanel .rl-grade-score{font-size:26px;font-weight:1000;color:#f5d76e;min-width:76px;text-align:center}',
    '#rhymelightPanel .rl-grade-detail{flex:1;min-width:0;color:#b4c3d5;font-size:9px}',
    '#rhymelightPanel .rl-grade-row{display:grid;grid-template-columns:125px minmax(0,1fr) 38px;gap:7px;align-items:center;margin:5px 8px;font-size:9px;color:#aebed0}',
    '#rhymelightPanel .rl-grade-bar{height:7px;background:#263548;border-radius:9px;overflow:hidden}',
    '#rhymelightPanel .rl-grade-bar i{display:block;height:100%;background:#f5d76e}',
    '#rhymelightPanel .rl-export-row{display:flex;justify-content:flex-end;gap:6px;padding:0 8px 8px;flex-wrap:wrap}',
    '#rhymelightPanel .rl-colour-counts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:8px}',
    '#rhymelightPanel .rl-colour-count{padding:6px;border-radius:5px;font-size:9px;font-weight:800;border:1px solid #ffffff30;cursor:pointer;text-align:left}',
    '#rhymelightPanel .rl-status{margin-top:9px;color:#c1d0e2;font-size:11px}#rhymelightPanel .rl-status.error{color:#ff9d9d}#rhymelightPanel .rl-status.warn{color:#f4d58a}',
    '#rhymelightPanel .rl-results-head{margin:16px 0 8px;font-weight:900;color:#f5d76e;letter-spacing:1px}',
    '#rhymelightPanel .rl-legend{display:flex;gap:5px;flex-wrap:wrap;margin:9px 0}',
    '#rhymelightPanel .rl-chip{border:1px solid #3a4a5e;border-radius:20px;padding:4px 8px;color:var(--rl-text-color,#000000);background:var(--rl-color,#263548);font-size:10px;font-weight:900;cursor:pointer}',
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
    '#rhymelightPanel .rl-token.hl{background:var(--rl-color);color:var(--rl-text-color,#000000);font-weight:800}',
    '#rhymelightPanel .rl-genius-line{color:inherit;text-decoration:none;border-bottom:1px dotted #7f9cbd;cursor:pointer}',
    '#rhymelightPanel .rl-genius-line:hover{border-bottom:1px solid #f5d76e;background:#f5d76e0c}',
    '#rhymelightPanel .rl-genius-mark{display:inline-block;margin-left:6px;color:#91a9c5;font:800 8px/1.4 Inter,system-ui,sans-serif;vertical-align:middle}',
    '#rhymelightPanel .rl-genius-preview{margin-top:12px;border:1px solid #354960;border-radius:8px;overflow:hidden;background:#fff}',
    '#rhymelightPanel .rl-genius-preview-head{padding:9px 10px;background:#172538;color:#f5d76e;align-items:center}',
    '#rhymelightPanel .rl-genius-preview iframe{display:block;width:100%;height:min(68vh,720px);min-height:420px;border:0;background:#fff}',
    '#rhymelightPanel .rl-genius-settings{padding:10px;background:#0d1724;border:1px solid #354960;border-radius:7px;margin:10px 0}',
    '#rhymelightPanel .rl-genius-settings label{display:block;color:#aebed0;font-size:10px;font-weight:900;letter-spacing:.4px}',
    '#rhymelightPanel .rl-genius-settings input{display:block;width:100%;margin:5px 0 8px;background:#080f18;color:#e5edf7;border:1px solid #40536a;border-radius:6px;padding:9px}',
    '#rhymelightPanel .rl-genius-api-title{color:#f5d76e;font-size:10px;font-weight:900;letter-spacing:.7px;margin:12px 0 7px}',
    '#rhymelightPanel .rl-genius-song-result{display:flex;width:100%;flex-direction:column;text-align:left;gap:2px;background:#152335;border:1px solid #354960;border-radius:6px;padding:9px;margin:5px 0;color:#e5edf7;cursor:pointer}',
    '#rhymelightPanel .rl-genius-song-result span,.rl-genius-meta{font-size:10px;color:#9db0c6}',
    '#rhymelightPanel .rl-genius-annotation{margin:8px 0;padding:9px;border:1px solid #344960;border-radius:7px;background:#101b29}',
    '#rhymelightPanel .rl-genius-fragment{font-weight:900;color:#f5d76e;margin-bottom:7px}',
    '#rhymelightPanel .rl-genius-explanation{padding:8px 0;border-top:1px solid #28394d;color:#dce6f2;font-size:12px;line-height:1.55}',
    '#rhymelightPanel .rl-genius-meta{margin-bottom:5px}',
    '#rhymelightPanel .rl-genius-verified{color:#8de0a8}',
    '#rhymelightPanel .rl-genius-error{padding:10px;color:#ff9da9;background:#2a1119;border-radius:6px;margin:8px 0}',
    '#rhymelightPanel .rl-genius-line{display:inline;border:0;background:transparent;padding:0;font:inherit;text-align:left}',
    '#rhymelightPanel .rl-grade-incomplete{color:#f0d18b}',
    '#rhymelightPanel .rl-grade-missing{font-size:9px;color:#e6bd7d;margin:2px 9px 8px}',
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
    '@media(max-width:430px){#rhymelightPanel{padding:9px}#rhymelightPanel .rl-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#rhymelightPanel .rl-compare-row{grid-template-columns:68px minmax(0,1fr)}#rhymelightPanel .rl-bar-name{width:52px}#rhymelightPanel .rl-library-row{grid-template-columns:minmax(0,1fr) auto}#rhymelightPanel .rl-library-row [data-rl-library-delete]{grid-column:1/-1}#rhymelightPanel .rl-grade-row{grid-template-columns:90px minmax(0,1fr) 30px}#rhymelightPanel .rl-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}'
  ].join('\n');

  function addStyle(doc) {
    if (doc.getElementById('rhymelight-style')) return;
    var style = doc.createElement('style'); style.id = 'rhymelight-style'; style.textContent = CSS; doc.head.appendChild(style);
  }

  function renderTrackEditors() {
    var host = state.panel.querySelector('[data-rl-track-editors]');
    if (!host) return;
    host.innerHTML = state.tracks.map(function (track, index) {
      return '<section class="rl-track-editor" data-rl-track="' + index + '"><div class="rl-track-top"><select data-rl-preset aria-label="Benchmark track ' + (index + 1) + '">' + optionsMarkup(track.preset) + '</select><button type="button" class="rl-quiet" data-rl-genius-search data-rl-genius-query="' + escapeHTML(track.name + ' lyrics annotations') + '" title="Preview this song and its annotations from Genius inside Rhymelight">GENIUS ▣</button><button type="button" class="rl-quiet" data-rl-remove="' + index + '"' + (state.tracks.length <= 2 ? ' disabled' : '') + '>REMOVE</button></div>' +
        '<input class="rl-track-name" type="text" data-rl-name maxlength="90" aria-label="Track name" value="' + escapeHTML(track.name) + '" placeholder="Artist — song title">' +
        '<textarea data-rl-lyrics maxlength="50000" aria-label="Song passage" placeholder="Paste the passage you want to compare — one bar per line…">' + escapeHTML(track.lyrics) + '</textarea>' +
        '<div class="rl-meta-grid">' +
          '<label class="rl-meta-field">TEMPO BPM<input data-rl-bpm type="number" min="40" max="240" step="1" placeholder="e.g. 140" value="' + (track.bpm == null ? '' : escapeHTML(track.bpm)) + '"></label>' +
          '<label class="rl-meta-field">PASSAGE SECONDS<input data-rl-duration type="number" min="0.5" max="3600" step="0.1" placeholder="Exact duration" value="' + (track.durationSeconds == null ? '' : escapeHTML(track.durationSeconds)) + '"></label>' +
          '<label class="rl-meta-field">WORDPLAY / 10<input data-rl-wordplay type="number" min="0" max="10" step="1" placeholder="Rate 0–10" value="' + (track.wordplayScore == null ? '' : escapeHTML(track.wordplayScore)) + '"></label>' +
          '<label class="rl-meta-field">IMAGERY / 10<input data-rl-imagery type="number" min="0" max="10" step="1" placeholder="Rate 0–10" value="' + (track.imageryScore == null ? '' : escapeHTML(track.imageryScore)) + '"></label>' +
          '<label class="rl-meta-field">TECHNICAL WIT / 10<input data-rl-technical-wit type="number" min="0" max="10" step="1" placeholder="Rate 0–10" value="' + (track.technicalWitScore == null ? '' : escapeHTML(track.technicalWitScore)) + '"></label>' +
        '</div><div class="rl-editor-help">BPM + exact duration measure delivery. Three artistry ratings are human assessments; leave blank for a provisional technical grade.</div>' +
        '<div class="rl-row rl-save-row"><button type="button" class="rl-quiet" data-rl-save="' + index + '">SAVE TO MY LIBRARY</button></div>' +
        '<div class="rl-muted">' + (index + 1) + ' / ' + getMaxTracks() + ' · ' + String((track.lyrics || '').length).toLocaleString() + ' characters</div></section>';
    }).join('');
    var add = state.panel.querySelector('[data-rl-add]');
    if (add) add.disabled = state.tracks.length >= getMaxTracks();
    renderLibraryControls();
  }

  function colorStyle(index) {
    if (index === undefined) return '';
    var color = getPalette()[index % getPalette().length];
    return 'style="--rl-color:' + color + ';--rl-text-color:' + paletteTextColor(color) + '"';
  }

  function renderComparison(result) {
    var out = state.panel.querySelector('[data-rl-results]');
    if (!out) return;
    var analyses = result.tracks.map(function (track) { return track.analysis; });
    var colors = buildColorMap(analyses);
    var allCounts = tally(analyses, state.view);
    var colourCounts = buildColorCounts(analyses, colors);
    var globalSounds = new Map(result.groups.map(function (g) { return [g.id, g.sound]; }));
    function colorFor(id) { return id && (allCounts.get(id) || 0) >= 2 ? colors.get(id) : undefined; }
    var legend = Array.from(allCounts.entries()).filter(function (pair) { return pair[1] >= 2; }).sort(function (a, b) { return (colors.get(a[0]) || 0) - (colors.get(b[0]) || 0); });
    var html = '<div class="rl-results-head">COMPARISON MAP</div><div class="rl-sheet"><div class="rl-row" style="justify-content:space-between"><strong>' + result.tracks.length + ' TRACKS · ' + result.tracks.reduce(function (n, t) { return n + t.metrics.lines; }, 0) + ' LINES</strong><span class="rl-muted">ONE COLOUR = ONE SOUND</span></div>';
    html += '<div class="rl-tabs" role="tablist">' + ['syllables', 'words', 'lines'].map(function (view) {
      return '<button type="button" class="rl-pill ' + (state.view === view ? 'active' : '') + '" data-rl-view="' + view + '">' + view.toUpperCase() + '</button>';
    }).join('') + '</div>';
    if (legend.length) html += '<div class="rl-legend">' + legend.map(function (pair) {
      var id = pair[0], entry = colourCounts.find(function (item) { return item.id === id; });
      var description = entry ? entry.syllables + ' SYL · ' + entry.words + ' WORDS · ' + entry.lines + ' LINES' : pair[1] + ' MATCHES';
      return '<button type="button" class="rl-chip ' + (state.focus && state.focus !== id ? 'dimmed' : '') + '" data-rl-focus="' + escapeHTML(id) + '" ' + colorStyle(colors.get(id)) + '>' + escapeHTML(paletteNote(colors.get(id))) + ' · ' + escapeHTML(globalSounds.get(id) || id) + ' · ' + description + '</button>';
    }).join('') + '</div>';
    else html += '<div class="rl-muted">No repeated phonetic rhyme groups found yet. Add more lines or compare another passage.</div>';
    if (colourCounts.length) {
      html += '<div class="rl-sectionhead" style="margin-top:10px">COLOUR COUNTS · TAP TO FILTER</div><div class="rl-colour-counts">' + colourCounts.map(function (entry) {
        var active = state.focus && state.focus !== entry.id ? ' opacity:.22;' : '';
        return '<button type="button" class="rl-colour-count" data-rl-focus="' + escapeHTML(entry.id) + '" style="background:' + entry.color + ';color:' + entry.textColor + ';' + active + '">' + escapeHTML(entry.note) + ' · ' + escapeHTML(entry.sound) + '<br>' + entry.syllables + ' SYL · ' + entry.words + ' WORDS · ' + entry.lines + ' LINES<br>' + entry.uniqueWords + ' WORD FORMS · ' + entry.tracks + ' TRACKS</button>';
      }).join('') + '</div>';
    }
    if (result.sharedGroups.length) {
      html += '<div class="rl-muted" style="margin-top:8px">SHARED BETWEEN TRACKS: ' + result.sharedGroups.map(function (g) { return escapeHTML(g.sound); }).join(' · ') + '</div>';
    }
    html += '</div>';
    html += renderMetricComparison(result);
    result.tracks.forEach(function (track) {
      var metrics = track.metrics, grade = metrics.complexityGrade || calculateComplexityGrade(metrics);
      var letters = schemeLetters(track.analysis.lines, new Set(tally([track.analysis], 'lines').keys()));
      var trackId = escapeHTML(track.id);
      html += '<section class="rl-track-result"><div class="rl-result-title"><span class="rl-result-name">' + escapeHTML(track.name) + '</span><span class="rl-muted">' + Math.round(metrics.dictionaryCoverage * 100) + '% PHONETIC COVERAGE</span></div>';
      html += '<div class="rl-grade"><div class="rl-grade-score">' + grade.total + '%</div><div class="rl-grade-detail"><strong>OVERALL LYRIC COMPLEXITY</strong><br><span class="' + (grade.complete ? '' : 'rl-grade-incomplete') + '">' + (grade.complete ? 'Full weighted grade' : 'PROVISIONAL · ' + grade.missing.length + ' artistry ratings missing') + '</span><br>Automated phonetic metrics + transparent human ratings</div></div>';
      html += grade.components.map(function (component) {
        var absent = component.score === null;
        return '<div class="rl-grade-row"><span>' + escapeHTML(component.label) + ' (' + component.weight + '%)</span><span class="rl-grade-bar"><i style="width:' + (absent ? 0 : component.score).toFixed(1) + '%;opacity:' + (absent ? '.25' : '1') + '"></i></span><strong>' + (absent ? '—' : component.score.toFixed(0)) + '</strong></div>';
      }).join('');
      if (!grade.complete) html += '<div class="rl-grade-missing">Complete the Wordplay, Imagery and Technical Wit ratings above for the full weighted grade.</div>';
      html += '<div class="rl-muted" style="margin:3px 9px 8px">' + escapeHTML(metrics.flowMethod) + (metrics.deliveryMeasured ? ' · ' + metrics.syllablesPerSecond.toFixed(2) + ' syllables/sec' + (metrics.syllablesPerBeat == null ? '' : ' · ' + metrics.syllablesPerBeat.toFixed(2) + ' syllables/beat @ ' + metrics.bpm + ' BPM') : '') + '</div>';
      html += '<div class="rl-metrics">' + [
        ['LINES', metrics.lines], ['SYLLABLES', metrics.syllables], ['RHYME DENSITY', Math.round(metrics.rhymeDensity * 100) + '%'],
        ['MULTI PATTERNS', metrics.multiRhymes], ['INTERNAL', metrics.internalRhymes], ['FLOW', metrics.flowScore.toFixed(0) + '%'],
        ['SUSTAINED', metrics.sustainedComplexity.toFixed(0) + '%'], ['TEMPO', metrics.bpm == null ? '—' : metrics.bpm + ' BPM'], ['SHARED SOUNDS', metrics.sharedRhymeSounds]
      ].map(function (item) { return '<div class="rl-metric"><strong>' + item[1] + '</strong><span>' + item[0] + '</span></div>'; }).join('') + '</div>';
      html += '<div class="rl-export-row"><button type="button" class="rl-quiet" data-rl-export-jpeg="' + trackId + '">EXPORT JPEG</button><button type="button" class="rl-quiet" data-rl-export-pdf="' + trackId + '">EXPORT PDF</button></div>';
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
          return word.syllables.map(function (syllable) {
            var c = colorFor(syllable.group), dim = state.focus && state.focus !== syllable.group ? ' dimmed' : '';
            return '<span class="rl-token' + (c === undefined ? '' : ' hl') + (syllable.stressed ? ' rl-stress' : '') + dim + '" ' + colorStyle(c) + '>' + escapeHTML(syllable.text) + '</span>';
          }).join('<span style="color:#62748b">·</span>') + space;
        }).join('');
        var lineDim = state.focus && state.view === 'lines' && state.focus !== line.group ? ' dimmed' : '';
        var lineStyle = lineColor === undefined ? '' : 'style="background:' + getPalette()[lineColor] + '18;border-left:3px solid ' + getPalette()[lineColor] + ';padding-left:5px"';
        var count = line.words.reduce(function (n, w) { return n + w.syllables.length; }, 0);
        var rawLyricLine = line.words.map(function (word) { return word.text; }).join(' ');
        var geniusQuery = track.name + ' ' + rawLyricLine + ' annotation meaning';
        return '<div class="rl-sheetline"><span class="rl-letter">' + letters[li] + '</span><div style="min-width:0;flex:1"><span class="rl-muted" style="font-size:8px;margin-right:6px">' + count + ' SYL</span><button type="button" class="rl-genius-line ' + lineDim + '" data-rl-genius-search data-rl-genius-query="' + escapeHTML(geniusQuery) + '" title="Preview Genius explanations for this lyric line inside Rhymelight" ' + lineStyle + '>' + content + '<span class="rl-genius-mark">GENIUS ▣</span></button></div></div>'; 
      }).join('') + '</div></section>';
    });
    html += '<div class="rl-note">Grade weights: rhyme density 30%, multisyllabic patterns 30%, internal rhymes 25%, stress-pattern variation 15%. Each component is normalised against a fixed reference threshold and capped at 100. Dictionary coverage is shown separately as confidence context. This is an analysis heuristic, not a definitive measure of lyric quality, wordplay, delivery or influence.</div>';
    out.innerHTML = html;
  }

  function renderMetricComparison(result) {
    var specs = [
      { key: 'complexityGrade', label: 'Overall grade', read: function (m) { return m.complexityGrade ? m.complexityGrade.total : calculateComplexityGrade(m).total; }, format: function (v) { return v + '%'; }, max: 100 },
      { key: 'rhymeDensity', label: 'Rhyme density', read: function (m) { return m.rhymeDensity; }, format: function (v) { return Math.round(v * 100) + '%'; }, max: 1 },
      { key: 'multiRhymes', label: 'Multi patterns / 16 lines', read: function (m) { return m.lines ? m.multiRhymes / m.lines * 16 : 0; }, format: function (v) { return v.toFixed(1); } },
      { key: 'internalRhymes', label: 'Internal / 100 syl', read: function (m) { return m.syllables ? m.internalRhymes / m.syllables * 100 : 0; }, format: function (v) { return v.toFixed(1); } },
      { key: 'flowScore', label: 'Flow / rhythm', read: function (m) { return m.flowScore; }, format: function (v) { return v.toFixed(0) + '%'; }, max: 100 },
      { key: 'sustainedComplexity', label: 'Sustained complexity', read: function (m) { return m.sustainedComplexity; }, format: function (v) { return v.toFixed(0) + '%'; }, max: 100 },
      { key: 'deliveryRate', label: 'Delivery pace (syllables/sec)', read: function (m) { return m.deliveryMeasured ? m.syllablesPerSecond : null; }, format: function (v) { return v == null ? '—' : v.toFixed(2); } },
      { key: 'sharedRhymeSounds', label: 'Shared sounds', read: function (m) { return m.sharedRhymeSounds; }, format: function (v) { return String(v); } }
    ];
    var html = '<div class="rl-compare"><div class="rl-sectionhead">COMPLEXITY COMPARISON</div>';
    specs.forEach(function (spec) {
      var values = result.tracks.map(function (t) { return spec.read(t.metrics); });
      var numericValues = values.filter(function (value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); });
      var max = spec.max || Math.max(1, ...numericValues);
      html += '<div class="rl-compare-row"><div class="rl-compare-label">' + spec.label + '</div><div class="rl-barstack">';
      result.tracks.forEach(function (track, i) {
        var value = values[i], width = value == null ? 0 : Math.max(0, Math.min(100, value / max * 100));
        html += '<div class="rl-barline"><span class="rl-bar-name">' + escapeHTML(track.name) + '</span><span class="rl-bar-track"><i style="width:' + width.toFixed(1) + '%;background:' + getPalette()[i % getPalette().length] + '"></i></span><span class="rl-bar-value">' + spec.format(value) + '</span></div>';
      });
      html += '</div></div>';
    });
    return html + '</div>';
  }

  function xmlEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch];
    });
  }

  function makeTrackSvg(track) {
    var resultTracks = state.results ? state.results.tracks : [track];
    var analyses = resultTracks.map(function (item) { return item.analysis; });
    var colors = buildColorMap(analyses);
    var counts = tally(analyses, 'syllables');
    var grade = track.metrics.complexityGrade || calculateComplexityGrade(track.metrics);
    var width = 1600, lineHeight = 48, y = 220, body = [];
    var sourceLines = track.analysis.sourceLines || track.analysis.lines.map(function (line) { return line.words.map(function (word) { return word.text; }).join(' '); });
    var lineBySource = new Map(track.analysis.lines.map(function (line) { return [line.sourceIndex, line]; }));
    var activeColors = buildColorCounts(analyses, colors);
    y = 245 + activeColors.length * 22;
    function addText(x, baseline, text, fill, size, weight) {
      body.push('<text x="' + x.toFixed(1) + '" y="' + baseline.toFixed(1) + '" fill="' + (fill || '#EAF0F8') + '" font-family="DejaVu Sans Mono,monospace" font-size="' + (size || 21) + '" font-weight="' + (weight || 500) + '">' + xmlEscape(text) + '</text>');
    }
    sourceLines.forEach(function (rawLine, li) {
      var line = lineBySource.get(li), matches = [], match, regex = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
      while ((match = regex.exec(rawLine))) matches.push({ text: match[0], index: match.index });
      var wi = 0, cursor = 0, x = 56, lineY = y;
      addText(28, lineY + 4, String(li + 1).padStart(3, '0'), '#8EA3BB', 13, 700);
      function drawPlain(text) {
        if (!text) return;
        var chunks = text.split(/(\s+)/);
        chunks.forEach(function (chunk) {
          if (!chunk) return;
          var chunkWidth = chunk.length * 12.7;
          if (x + chunkWidth > width - 45) { x = 56; y += 42; }
          addText(x, y + 4, chunk, '#EAF0F8', 20, 500);
          x += chunkWidth;
        });
      }
      matches.forEach(function (item) {
        drawPlain(rawLine.slice(cursor, item.index));
        var word = line && line.words[wi]; wi++;
        if (!word) { drawPlain(item.text); cursor = item.index + item.text.length; return; }
        word.syllables.forEach(function (syllable, si) {
          var token = syllable.text || '';
          var tokenWidth = Math.max(14, token.length * 12.7), repeated = syllable.group && (counts.get(syllable.group) || 0) >= 2;
          var colorIndex = repeated ? colors.get(syllable.group) : undefined;
          var color = colorIndex === undefined ? null : getPalette()[colorIndex % getPalette().length];
          if (x + tokenWidth + 7 > width - 45) { x = 56; y += 42; }
          if (si > 0) { addText(x, y + 4, '·', '#7E91A8', 16, 400); x += 13; }
          if (color) body.push('<rect x="' + (x - 4) + '" y="' + (y - 23) + '" width="' + (tokenWidth + 8) + '" height="32" rx="4" fill="' + color + '"/>');
          addText(x, y + 2, token, color ? paletteTextColor(color) : '#EAF0F8', 20, syllable.stressed ? 800 : 500);
          if (syllable.stressed) body.push('<path d="M ' + x + ' ' + (y + 8) + ' h ' + Math.max(10, tokenWidth - 1) + '" stroke="' + (color ? paletteTextColor(color) : '#EAF0F8') + '" stroke-width="1.5"/>');
          x += tokenWidth + 7;
        });
        cursor = item.index + item.text.length;
      });
      drawPlain(rawLine.slice(cursor));
      y = Math.max(y, lineY) + lineHeight;
    });
    var height = Math.max(700, y + 110);
    if (height > 26000) throw new Error('This passage is too long for a single-page image export. Export a shorter section.');
    var metricLabels = [
      'Rhyme density ' + Math.round(track.metrics.rhymeDensity * 100) + '%',
      'Multisyllabic patterns ' + track.metrics.multiRhymes,
      'Internal rhymes ' + track.metrics.internalRhymes,
      'Flow ' + Math.round(track.metrics.flowScore) + '%',
      'Sustained ' + Math.round(track.metrics.sustainedComplexity) + '%',
      'Delivery ' + (track.metrics.deliveryMeasured ? track.metrics.syllablesPerSecond.toFixed(2) + ' syl/sec' : 'text-only rhythm proxy'),
      'BPM ' + (track.metrics.bpm == null ? 'not supplied' : track.metrics.bpm),
      'Dictionary coverage ' + Math.round(track.metrics.dictionaryCoverage * 100) + '%'
    ];
    var head = '<rect width="100%" height="100%" fill="#0B111B"/><text x="56" y="65" fill="#F5D76E" font-family="Arial,sans-serif" font-size="38" font-weight="900">RHYME LIGHT</text>' +
      '<text x="56" y="112" fill="#F0F4FA" font-family="Arial,sans-serif" font-size="27" font-weight="700">' + xmlEscape(track.name) + '</text>' +
      '<text x="56" y="165" fill="#F5D76E" font-family="Arial,sans-serif" font-size="35" font-weight="900">COMPLEXITY GRADE: ' + grade.total + '%</text>' +
      '<text x="56" y="195" fill="#A9B8CB" font-family="Arial,sans-serif" font-size="18">' + xmlEscape(metricLabels.join('     ·     ')) + '</text>';
    var footer = '<text x="56" y="' + (height - 48) + '" fill="#92A4BC" font-family="Arial,sans-serif" font-size="15">IMPROVS2 · RHYMELIGHT · CIRCLE OF FOURTHS COLOUR KEY · LOCAL PHONETIC ANALYSIS</text>';
    var legendY = 255, legendMarkup = activeColors.map(function (entry) {
      var text = entry.note + ' ' + entry.sound + ' (' + entry.syllables + ')';
      var result = '<rect x="56" y="' + (legendY - 15) + '" width="18" height="18" rx="3" fill="' + entry.color + '"/><text x="82" y="' + legendY + '" fill="#D7E1EF" font-family="Arial,sans-serif" font-size="14">' + xmlEscape(text) + '</text>';
      legendY += 22;
      return result;
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + head + '<g>' + legendMarkup + '</g><g>' + body.join('') + '</g>' + footer + '</svg>';
  }

  function downloadBlob(root, blob, filename) {
    var url = root.URL.createObjectURL(blob), anchor = root.document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    root.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 2000);
  }

  function exportTrack(format, trackId) {
    var track = state.results && state.results.tracks.find(function (item) { return item.id === String(trackId); });
    if (!track) { updateStatus('Run a comparison before exporting.', 'warn'); return; }
    var root = state.root, svg = makeTrackSvg(track), svgBlob = new root.Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var svgUrl = root.URL.createObjectURL(svgBlob), image = new root.Image();
    updateStatus('Preparing the colour-coded ' + format.toUpperCase() + ' report…');
    image.onload = function () {
      try {
        var canvas = root.document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
        var context = canvas.getContext('2d');
        context.fillStyle = '#0B111B'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
        canvas.toBlob(async function (jpegBlob) {
          try {
            if (!jpegBlob) throw new Error('The browser could not render a JPEG image.');
            var base = String(track.name || 'rhymelight').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rhymelight';
            if (format === 'jpeg') {
              downloadBlob(root, jpegBlob, base + '-rhymelight.jpg');
            } else {
              var bytes = new Uint8Array(await jpegBlob.arrayBuffer());
              var pdf = makeImagePdf(bytes, canvas.width, canvas.height);
              downloadBlob(root, new root.Blob([pdf], { type: 'application/pdf' }), base + '-rhymelight.pdf');
            }
            updateStatus(format.toUpperCase() + ' export created.');
          } catch (err) { updateStatus(err.message || 'Export failed.', 'error'); }
        }, 'image/jpeg', 0.94);
      } catch (err) { updateStatus(err.message || 'Export failed.', 'error'); }
      finally { root.URL.revokeObjectURL(svgUrl); }
    };
    image.onerror = function () { root.URL.revokeObjectURL(svgUrl); updateStatus('The browser could not render the export image.', 'error'); };
    image.src = svgUrl;
  }

  function saveTrackToLibrary(index) {
    var editor = state.panel.querySelector('[data-rl-track="' + index + '"]');
    if (editor) syncTrackFromEditor(editor);
    var track = state.tracks[index];
    if (!track) return;
    var existing = track.libraryId && findLibrarySong(track.libraryId);
    var id = existing && !existing.isBuiltin ? existing.id : undefined;
    try {
      state.library = upsertLibrarySong(state.library, {
        id: id, name: track.name, lyrics: track.lyrics, artist: '', isBuiltin: false,
        bpm: track.bpm, durationSeconds: track.durationSeconds, wordplayScore: track.wordplayScore,
        imageryScore: track.imageryScore, technicalWitScore: track.technicalWitScore,
        source: 'Saved from IMPROVS2 Rhymelight'
      });
      var saved = state.library[state.library.length - 1];
      if (id) saved = findLibrarySong(id);
      track.libraryId = saved.id; track.preset = 'library:' + saved.id;
      if (!persistLibrary(state.root)) return;
      renderTrackEditors();
      updateStatus('Saved “' + saved.name + '” to your local song library.');
    } catch (err) { updateStatus(err.message || 'Could not save this song.', 'error'); }
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
    track.bpm = optionalNumber(editor.querySelector('[data-rl-bpm]') && editor.querySelector('[data-rl-bpm]').value, 40, 240);
    track.durationSeconds = optionalNumber(editor.querySelector('[data-rl-duration]') && editor.querySelector('[data-rl-duration]').value, 0.5, 3600);
    track.wordplayScore = optionalNumber(editor.querySelector('[data-rl-wordplay]') && editor.querySelector('[data-rl-wordplay]').value, 0, 10);
    track.imageryScore = optionalNumber(editor.querySelector('[data-rl-imagery]') && editor.querySelector('[data-rl-imagery]').value, 0, 10);
    track.technicalWitScore = optionalNumber(editor.querySelector('[data-rl-technical-wit]') && editor.querySelector('[data-rl-technical-wit]').value, 0, 10);
  }

  var GENIUS_TOKEN_STORAGE_KEY = 'improvs2.rhymelight.genius.client_token.v1';

  function loadGeniusToken(root) {
    try { state.geniusToken = root.localStorage ? String(root.localStorage.getItem(GENIUS_TOKEN_STORAGE_KEY) || '') : ''; }
    catch (err) { state.geniusToken = ''; }
    var label = state.panel && state.panel.querySelector('[data-rl-genius-token-state]');
    if (label) label.textContent = state.geniusToken ? 'TOKEN SAVED ON THIS DEVICE' : 'TOKEN NOT SET';
  }

  function saveGeniusToken() {
    var input = state.panel && state.panel.querySelector('[data-rl-genius-token]');
    var token = input ? String(input.value || '').trim() : '';
    if (!token) { updateStatus('Paste your Genius Client Access Token first.', 'warn'); return; }
    state.geniusToken = token;
    try {
      if (!state.root.localStorage) throw new Error('Local storage unavailable');
      state.root.localStorage.setItem(GENIUS_TOKEN_STORAGE_KEY, token);
      if (input) input.value = '';
      var label = state.panel.querySelector('[data-rl-genius-token-state]');
      if (label) label.textContent = 'TOKEN SAVED ON THIS DEVICE';
      updateStatus('Genius Client Access Token saved on this device.');
    } catch (err) { updateStatus('Token is active for this session but could not be saved on this device.', 'warn'); }
  }

  function clearGeniusToken() {
    state.geniusToken = '';
    try { if (state.root && state.root.localStorage) state.root.localStorage.removeItem(GENIUS_TOKEN_STORAGE_KEY); } catch (err) {}
    var input = state.panel && state.panel.querySelector('[data-rl-genius-token]');
    var label = state.panel && state.panel.querySelector('[data-rl-genius-token-state]');
    if (input) input.value = '';
    if (label) label.textContent = 'TOKEN NOT SET';
    updateStatus('Genius token removed from this device.');
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
    if (event.target.matches && event.target.matches('[data-rl-library-select]')) { renderLibraryControls(); return; }
    if (!event.target.matches || !event.target.matches('[data-rl-preset]')) return;
    var editor = event.target.closest('[data-rl-track]');
    if (!editor) return;
    var index = Number(editor.getAttribute('data-rl-track'));
    var track = state.tracks[index];
    if (!track) return;
    track.preset = event.target.value;
    var savedId = track.preset.indexOf('library:') === 0 ? track.preset.slice(8) : '';
    var saved = savedId ? findLibrarySong(savedId) : null;
    if (saved) {
      track.libraryId = saved.id; track.name = saved.name; track.lyrics = saved.lyrics;
      track.bpm = saved.bpm; track.durationSeconds = saved.durationSeconds;
      track.wordplayScore = saved.wordplayScore; track.imageryScore = saved.imageryScore;
      track.technicalWitScore = saved.technicalWitScore;
    } else {
      track.libraryId = '';
      var benchmark = getBenchmarks().find(function (b) { return b.id === track.preset; });
      if (benchmark) {
        track.name = benchmark.artist + ' — ' + benchmark.song;
        var seed = state.seedLibrary.find(function (song) { return song.id === 'benchmark-rap-god' && benchmark.id === 'eminem'; });
        track.lyrics = seed ? seed.lyrics : '';
        track.bpm = null; track.durationSeconds = null; track.wordplayScore = null; track.imageryScore = null; track.technicalWitScore = null;
      } else if (track.preset === 'custom') {
        track.name = ''; track.lyrics = '';
        track.bpm = null; track.durationSeconds = null; track.wordplayScore = null; track.imageryScore = null; track.technicalWitScore = null;
      }
    }
    renderTrackEditors();
  }

  function onPanelClick(event) {
    var geniusClose = event.target.closest('[data-rl-genius-close]');
    if (geniusClose) { var geniusPanel = state.panel.querySelector('[data-rl-genius-panel]'); var geniusFrame = state.panel.querySelector('[data-rl-genius-frame]'); if (geniusFrame) geniusFrame.src = 'about:blank'; if (geniusPanel) geniusPanel.hidden = true; return; }
    if (event.target.closest('[data-rl-genius-token-save]')) { saveGeniusToken(); return; }
    if (event.target.closest('[data-rl-genius-token-clear]')) { clearGeniusToken(); return; }
    var geniusOpenUrl = event.target.closest('[data-rl-genius-open-url]');
    if (geniusOpenUrl) { var openUrl = geniusOpenUrl.getAttribute('data-rl-genius-open-url'); var openFrame = state.panel.querySelector('[data-rl-genius-frame]'); if (openFrame && validGeniusPageUrl(openUrl)) openFrame.src = openUrl; return; }
    var geniusSongButton = event.target.closest('[data-rl-genius-song-id]');
    if (geniusSongButton) { selectGeniusSong(Number(geniusSongButton.getAttribute('data-rl-genius-song-id')), geniusSongButton.getAttribute('data-rl-genius-song-url'), geniusSongButton.getAttribute('data-rl-genius-song-title')); return; }
    var geniusButton = event.target.closest('[data-rl-genius-search]');
    if (geniusButton) { searchGeniusInApp(geniusButton.getAttribute('data-rl-genius-query') || ''); return; }
    var closeButton = event.target.closest('[data-rl-close]');
    if (closeButton) { close(); return; }
    var save = event.target.closest('[data-rl-save]');
    if (save) { saveTrackToLibrary(Number(save.getAttribute('data-rl-save'))); return; }
    var libraryAdd = event.target.closest('[data-rl-library-add]');
    if (libraryAdd) {
      var select = state.panel.querySelector('[data-rl-library-select]');
      var song = select && findLibrarySong(select.value);
      if (!song) { updateStatus('Choose a saved song first.', 'warn'); return; }
      if (state.tracks.length >= getMaxTracks()) { updateStatus('The comparison already contains the maximum of six tracks.', 'warn'); return; }
      state.tracks.push({ id: 'track-' + Date.now() + '-' + state.tracks.length, preset: 'library:' + song.id, libraryId: song.id, name: song.name, lyrics: song.lyrics });
      renderTrackEditors(); updateStatus('Added “' + song.name + '” to the comparison.'); return;
    }
    var libraryDelete = event.target.closest('[data-rl-library-delete]');
    if (libraryDelete) {
      var librarySelect = state.panel.querySelector('[data-rl-library-select]');
      var selectedSong = librarySelect && findLibrarySong(librarySelect.value);
      if (!selectedSong || selectedSong.isBuiltin) return;
      state.library = deleteLibrarySong(state.library, selectedSong.id);
      persistLibrary(state.root); renderTrackEditors();
      updateStatus('Deleted “' + selectedSong.name + '” from this device library.'); return;
    }
    var jpeg = event.target.closest('[data-rl-export-jpeg]');
    if (jpeg) { exportTrack('jpeg', jpeg.getAttribute('data-rl-export-jpeg')); return; }
    var pdf = event.target.closest('[data-rl-export-pdf]');
    if (pdf) { exportTrack('pdf', pdf.getAttribute('data-rl-export-pdf')); return; }
    var add = event.target.closest('[data-rl-add]');
    if (add) {
      if (state.tracks.length >= getMaxTracks()) return;
      var next = getBenchmarks()[state.tracks.length % getBenchmarks().length];
      state.tracks.push({ id: 'track-' + Date.now() + '-' + state.tracks.length, preset: next.id, name: next.artist + ' — ' + next.song, lyrics: '' });
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
    if (populated.some(function (track) { return track.lyrics.length > 50000; })) { updateStatus('Each comparison passage must be 50,000 characters or fewer.', 'error'); return; }
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
    state.library = [];
    try { var rawLibrary = root.localStorage && root.localStorage.getItem(LIBRARY_STORAGE_KEY); if (rawLibrary) { var parsedLibrary = JSON.parse(rawLibrary); if (Array.isArray(parsedLibrary)) state.library = parsedLibrary; } } catch (err) { state.library = []; }
    state.tracks = initialTracks();
    state.panel.innerHTML = panelMarkup();
    loadGeniusToken(root);
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
    loadConfig(state.root).then(function () { if (!state.initialisedWithConfig) { state.tracks = initialTracks(); state.initialisedWithConfig = true; } renderTrackEditors(); updateStatus('Rap God is loaded. Your song library is stored locally on this device.'); }).catch(function (err) { updateStatus(err.message || 'Could not load local Rhymelight configuration.', 'error'); });
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
    buildColorCounts: buildColorCounts,
    calculateComplexityGrade: calculateComplexityGrade,
    geniusSearchUrl: geniusSearchUrl,
    geniusApiUrl: geniusApiUrl,
    parseGeniusSearch: parseGeniusSearch,
    parseGeniusSongDetails: parseGeniusSongDetails,
    geniusEmbedDocument: geniusEmbedDocument,
    parseGeniusReferents: parseGeniusReferents,
    geniusApiRequest: geniusApiRequest,
    calculateSustainedComplexity: calculateSustainedComplexity,
    upsertLibrarySong: upsertLibrarySong,
    deleteLibrarySong: deleteLibrarySong,
    makeImagePdf: makeImagePdf,
    primaryPaletteNotes: primaryPaletteNotes,
    paletteNote: paletteNote,
    paletteTextColor: paletteTextColor,
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
