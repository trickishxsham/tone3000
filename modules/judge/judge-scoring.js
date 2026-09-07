// modules/judge/judge-scoring.js
// version: 1.1.0 – pairs with judge.js v4.9.8.860
// Full taste list:
//   Bengine  → RHCP (funk hard rock) + Django Reinhardt (gypsy jazz)
//   Howie    → The Beatles + Billy Joel
//   Artie    → Bruce Springsteen + AC/DC
//   Billie   → Jimi Hendrix + Rory Gallagher
//   Jackie   → Eddie Van Halen + Mountain
//   Freddie  → BB King, SRV, Cream, Rolling Stones
(function () {
  'use strict';

  const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A', 'A+', 'S'];
  const GRADE_TO_NUM = Object.fromEntries(GRADE_ORDER.map((g, i) => [g, i]));

  function numToGrade(n) {
    n = Math.max(0, Math.min(6, Math.round(n)));
    return GRADE_ORDER[n];
  }

  function letterFromScore(score0to100) {
    if (score0to100 >= 95) return 'S';
    if (score0to100 >= 88) return 'A+';
    if (score0to100 >= 80) return 'A';
    if (score0to100 >= 70) return 'B';
    if (score0to100 >= 55) return 'C';
    if (score0to100 >= 40) return 'D';
    return 'F';
  }

  // ---------- Howie (latency-aware) ----------
  function howieTimingGrade(avgDevMs, maxSpikeMs) {
    // avgDevMs must already have Bluetooth compensation subtracted
    if (avgDevMs <= 35 && maxSpikeMs <= 70) return 'S';
    if (avgDevMs <= 45 && maxSpikeMs <= 90) return 'A+';
    if (avgDevMs <= 55 && maxSpikeMs <= 110) return 'A';
    if (avgDevMs <= 70 && maxSpikeMs <= 140) return 'B';
    if (avgDevMs <= 90 && maxSpikeMs <= 180) return 'C';
    if (avgDevMs <= 120) return 'D';
    return 'F';
  }

  // ---------- Consistency gate ----------
  function applyConsistency(grades) {
    const nums = {};
    for (const [k, v] of Object.entries(grades)) nums[k] = GRADE_TO_NUM[v] ?? 0;
    const maxG = Math.max(...Object.values(nums));

    // If anyone is S or A+, nobody below B
    if (maxG >= 5) {
      for (const k of Object.keys(nums)) {
        if (nums[k] < 3) nums[k] = 3;
      }
    }
    // Strong panel → Howie cannot be F
    if (maxG >= 4 && nums.Howie === 0) nums.Howie = 2;

    const out = {};
    for (const [k, v] of Object.entries(nums)) out[k] = GRADE_ORDER[v];
    return out;
  }

  // ---------- Judge definitions ----------
  const JUDGE_DEFS = {
    Bengine: {
      // Appreciates BOTH high-quality RHCP funk-hard-rock AND high-quality Django gypsy-jazz as distinct strengths
      weights: {
        note_choice: 0.40,
        funk_hard_rock: 0.25,
        gypsy_jazz: 0.25,
        musicality: 0.10
      },
      tasteBias: 0.90,
      colour: '#78D4EF',
      comments: {
        high: [
          'Clean engine. RHCP funk pocket and Django gypsy lines both speaking.',
          'Note choices locked. Chili Peppers grit and Reinhardt flash respected.',
          'Both languages fluent – tight funk-hard-rock and real gypsy jazz vocabulary.'
        ],
        mid: [
          'Solid note choice. Could push the RHCP funk harder or the Django runs further.',
          'Engine is running, but neither the Chili Peppers pocket nor the gypsy fire is fully lit.'
        ],
        low: [
          'Notes are wandering. The engine wants clearer intent – either tight RHCP funk or real Django vocabulary.',
          'Neither the funk-hard-rock nor the gypsy-jazz language is landing yet.'
        ]
      }
    },

    Howie: {
      // special-cased for timing
      tasteBias: 0.40,
      colour: '#F0483A',
      comments: {
        high: [
          'Time is serving the song. Proper Beatles / Billy Joel pocket.',
          'Centre is locked. Lennon-McCartney and Joel would both approve.'
        ],
        mid: [
          'Acceptable time once latency is considered. Keep the Beatles/Joel centre.',
          'Pocket is almost there – think more Rubber Soul, less rushing.'
        ],
        low: [
          'Still drifting more than a Beatles or Billy Joel track can hide.',
          'Time needs to serve the song the way the Beatles and Joel always did.'
        ]
      }
    },

    Artie: {
      weights: { tone: 0.45, energy: 0.40, musicality: 0.15 },
      tasteBias: 0.70,
      colour: '#00CC66',
      comments: {
        high: [
          'Butter. Pure Springsteen heart and AC/DC punch.',
          'Tone and drive are Boss-level with a proper Highway to Hell edge.'
        ],
        mid: [
          'Tone is good. Needs a bit more Springsteen grit or AC/DC weight.',
          'Almost there – give it more Born to Run or Back in Black attitude.'
        ],
        low: [
          'Tone is thin. Needs Springsteen muscle and AC/DC bite.',
          'Missing the Boss heart and the Young brothers’ punch.'
        ]
      }
    },

    Billie: {
      weights: { energy: 0.50, musicality: 0.30, note_choice: 0.20 },
      tasteBias: 0.90,
      colour: '#FFDD00',
      comments: {
        high: [
          'FERAL. Hendrix and Rory Gallagher would both nod.',
          'Proper wildfire – Jimi fire and Gallagher intensity locked in.'
        ],
        mid: [
          'Some fire. Let it get more Hendrix dirty or Gallagher raw.',
          'Almost feral – needs more Are You Experienced or Irish Tour 74 energy.'
        ],
        low: [
          'Too polite. Where’s the Hendrix chaos and Gallagher blood?',
          'Needs the wild edge Jimi and Rory always brought.'
        ]
      }
    },

    Jackie: {
      weights: { musicality: 0.45, tone: 0.25, note_choice: 0.15, energy: 0.15 },
      tasteBias: 0.80,
      colour: '#00CC66',
      comments: {
        high: [
          'Musically complete with real Van Halen flash and Mountain weight.',
          'Eddie tapping spirit and Leslie West power both showing up.',
          'Tight, musical, and carrying that Van Halen / Mountain punch.'
        ],
        mid: [
          'Solid overall. Could use more EVH flair or Mountain heaviness.',
          'Good foundation – needs a bit more Eruption energy or Nantucket Sleighride drive.'
        ],
        low: [
          'The story isn’t landing. Missing Van Halen sparkle and Mountain muscle.',
          'Needs more Eddie fire and Leslie West weight to come alive.'
        ]
      }
    },

    Freddie: {
      weights: { blues: 0.50, musicality: 0.30, tone: 0.20 },
      tasteBias: 0.95,
      colour: '#FF8844',
      comments: {
        high: [
          'Blues is talking. BB King, SRV, Cream and the Stones all present.',
          'Phrasing has the Lucille cry, the SRV fire, Clapton’s Cream bite and Stones swagger.'
        ],
        mid: [
          'Some blues feel. Dig deeper into BB, SRV, Cream or Stones phrasing.',
          'Close – needs more vibrato, space and cry like the kings.'
        ],
        low: [
          'Blues vocabulary is light. More BB King bend, SRV fire, Cream sustain, Stones attitude.',
          'Missing the language of BB, Stevie Ray, Clapton’s Cream and the Stones.'
        ]
      }
    }
  };

  function scoreJudge(def, metrics, tasteMatch) {
    let raw = 0, totalW = 0;
    for (const [key, w] of Object.entries(def.weights || {})) {
      const val = metrics[key] ?? 0.5;
      raw += val * w;
      totalW += w;
    }
    const core = totalW ? raw / totalW : 0.5;
    const adj = (def.tasteBias || 0) * (tasteMatch ?? 0.5) * 0.12;
    return numToGrade((core + adj) * 6);
  }

  function pickComment(def, gradeNum) {
    const pool = gradeNum >= 5 ? def.comments.high
               : gradeNum >= 3 ? def.comments.mid
               : def.comments.low;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Main entry – call this after a performance.
   * @param {Object} metrics  – all values 0–1 except timing (ms)
   * @param {Object} tasteMatches – optional 0–1 per judge
   * @returns {Object} shape that JudgePanel.show() expects
   */
  function judgePerformance(metrics, tasteMatches = {}) {
    const grades = {};

    // Howie special path
    grades.Howie = howieTimingGrade(
      metrics.avg_timing_deviation_ms ?? 999,
      metrics.max_timing_spike_ms ?? 999
    );

    // Everyone else
    for (const [name, def] of Object.entries(JUDGE_DEFS)) {
      if (name === 'Howie') continue;
      grades[name] = scoreJudge(def, {
        note_choice: metrics.note_choice_score,
        funk_hard_rock: metrics.funk_hard_rock_flavour,
        gypsy_jazz: metrics.gypsy_jazz_flavour,
        tone: metrics.tone_quality,
        energy: metrics.energy_aggression,
        blues: metrics.blues_phrasing,
        musicality: metrics.overall_musicality
      }, tasteMatches[name]);
    }

    // Consistency
    const finalGrades = applyConsistency(grades);

    // Build the array the UI expects (order doesn’t matter – UI matches by name)
    const judges = Object.keys(JUDGE_DEFS).map(name => {
      const g = finalGrades[name];
      const num = GRADE_TO_NUM[g];
      const def = JUDGE_DEFS[name];
      return {
        id: name.toLowerCase(),
        name: name.toUpperCase(),
        grade: g,
        colour: def.colour,
        comment: pickComment(def, num),
        coach: num >= 4 ? '' : (name === 'Howie' ? 'centre the time' : 'more intention'),
        coachKind: num >= 4 ? 'praise' : 'work'
      };
    });

    // Base engine grade for the BENGINE paddle (uses overall scoring)
    const overallScore = (
      (metrics.note_choice_score ?? 0.5) * 0.35 +
      (metrics.overall_musicality ?? 0.5) * 0.25 +
      (1 - Math.min(1, (metrics.avg_timing_deviation_ms ?? 100) / 120)) * 0.25 +
      (metrics.tone_quality ?? 0.5) * 0.15
    ) * 100;

    return {
      judges,
      grade: letterFromScore(overallScore),
      _raw: { scoring: Math.round(overallScore) }
    };
  }

  // Expose
  window.JudgeScoring = {
    judgePerformance,
    version: '1.1.0'
  };

  console.log('[modules] judge-scoring v1.1.0 ready');
})();
