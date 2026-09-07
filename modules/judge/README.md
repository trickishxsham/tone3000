# Judge Scoring Module (JS)

Version 1.1.0 – pairs with your existing `judge.js` v4.9.8.860

## Full Taste List
| Judge    | Favourites                                      |
|----------|-------------------------------------------------|
| Bengine  | Red Hot Chili Peppers (funk hard rock) + Django Reinhardt (gypsy jazz) |
| Howie    | The Beatles + Billy Joel                        |
| Artie    | Bruce Springsteen + AC/DC                       |
| Billie   | Jimi Hendrix + Rory Gallagher                   |
| Jackie   | Eddie Van Halen + Mountain                      |
| Freddie  | BB King, SRV, Cream, Rolling Stones             |

## Key Fixes
- Howie is latency-aware (Bluetooth compensation expected upstream)
- S + F combination is impossible
- Bengine scores real note choice and treats RHCP funk-hard-rock and Django gypsy-jazz as two separate high-value styles
- All six judges have full band-specific comment pools

## Usage
```js
const result = window.JudgeScoring.judgePerformance({
  avg_timing_deviation_ms: 48,        // already latency-compensated
  max_timing_spike_ms: 95,
  note_choice_score: 0.85,
  tone_quality: 0.78,
  energy_aggression: 0.70,
  blues_phrasing: 0.40,
  funk_hard_rock_flavour: 0.30,
  gypsy_jazz_flavour: 0.88,
  overall_musicality: 0.82
}, {
  Bengine: 0.85,
  Howie: 0.65,
  Artie: 0.45,
  Billie: 0.55,
  Jackie: 0.70,
  Freddie: 0.35
});

window.JudgePanel.show(result);
```

## Files
- `judge-scoring.js` – the scoring engine
- `README.md` – this file
