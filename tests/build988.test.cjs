'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

const rhyme = require(path.join(ROOT, 'tone3000/modules/rhymelight/rhymelight.js'));

test('Rhymelight 988 computes numeric Wordplay and Imagery scores instead of blank fields', () => {
  const dictionary = {
    i:'AY1', eye:'AY1', right:'R AY1 T', write:'R AY1 T',
    bars:'B AA1 R Z', court:'K AO1 R T',
    heart:'HH AA1 R T', stone:'S T OW1 N',
    like:'L AY1 K', fire:'F AY1 ER0',
    cold:'K OW1 L D', gold:'G OW1 L D',
    light:'L AY1 T', dark:'D AA1 R K',
    rise:'R AY1 Z', fall:'F AO1 L',
    I:'AY1', see:'S IY1', sea:'S IY1'
  };
  const lyrics = [
    'I see the sea when the bars meet the court',
    'I write the right when the heart turns stone',
    'My words are fire like a cold gold light',
    'I rise as you fall from dark into light'
  ].join('\n');
  const result = rhyme.analyzeComparison([{id:'x',name:'Test',lyrics}], dictionary);
  const metrics = result.tracks[0].metrics;
  const wordplay = metrics.complexityGrade.components.find(x => x.id === 'wordplay');
  const imagery = metrics.complexityGrade.components.find(x => x.id === 'imagery');
  assert.equal(typeof wordplay.score, 'number');
  assert.equal(typeof imagery.score, 'number');
  assert.ok(wordplay.score >= 0 && wordplay.score <= 100);
  assert.ok(imagery.score >= 0 && imagery.score <= 100);
  assert.ok(metrics.semanticCraft.wordplay.evidence.length > 0, 'wordplay evidence is surfaced');
  assert.ok(metrics.semanticCraft.imagery.evidence.length > 0, 'imagery evidence is surfaced');
  assert.equal(metrics.complexityGrade.complete, true, 'automatic estimates complete the grade');
});

test('Rhymelight lyric renderer puts the selected track grade card immediately before its coloured lyric sheet', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tone3000/modules/rhymelight/rhymelight.js'), 'utf8');
  const fn = source.slice(source.indexOf('function renderLyricsSummary('), source.indexOf('function renderComparison('));
  assert.ok(fn.includes('renderTrackGradePanel(track)'));
  assert.ok(fn.indexOf('renderTrackGradePanel(track)') < fn.indexOf('rl-song-sheet'));
});

test('Voice2Guitar 988 runs a faster overlapping pitch analysis and confirms auto-match in two frames', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tone3000/modules/voice2guitar/voice2guitar.js'), 'utf8');
  const sandbox = {
    window: { __MODULES: {}, registerModule() {}, __IMPROVS_MIC_POOL: { acquire(){}, release(){} } },
    document: { readyState: 'loading', addEventListener() {} },
    navigator: {}, localStorage: { getItem(){ return null; }, setItem(){} },
    performance: { now(){ return 0; } }, console, setTimeout(){ return 1; }, clearTimeout(){},
    PointerEvent: undefined, Event: function(){}, Blob, URL, TextEncoder, TextDecoder, Map, Set, Math, Date,
    confirm(){ return false; }, prompt(){ return null; }
  };
  vm.runInNewContext(source, sandbox, { filename: 'voice2guitar.js' });
  const v = sandbox.window.__voice2guitarTest;
  assert.ok(v, 'Voice2Guitar test API is installed');
  assert.equal(v.ANALYSIS_INTERVAL_MS, 32);
  assert.equal(v.AUTO_MATCH_STABLE_FRAMES, 2);
  let state = null;
  state = v.advanceAutoMatchCandidate(state, { hz:440, confidence:.95, rms:.02 });
  assert.equal(state.ready, false);
  state = v.advanceAutoMatchCandidate(state, { hz:440.2, confidence:.95, rms:.02 });
  assert.equal(state.ready, true);
  assert.equal(state.frames, 2);
});

test('Build 988 feature wiring declares matching modules and a separate ToneCraftAI entry', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tone3000/builds/app-988.html'), 'utf8');
  assert.match(html, /BUILD 988/);
  assert.match(html, /tonecraftai/);
  assert.match(html, /voice2guitar/);
  assert.match(html, /rhymelight/);
});

test('ToneCraftAI can target the eight NAM slots and four IR slots through the rig bridge', () => {
  const rig = fs.readFileSync(path.join(ROOT, 'tone3000/modules/rig/rig.js'), 'utf8');
  const craft = fs.readFileSync(path.join(ROOT, 'tone3000/modules/tonecraftai/tonecraftai.js'), 'utf8');
  assert.match(rig, /setSlotFx:async\(key,patch\)/);
  assert.match(rig, /setIRFx:async\(key,patch\)/);
  assert.match(rig, /tier:explicitTierForVariant\(json,model\)/);
  assert.match(rig, /fx:Object\.assign\(\{\},SLOT_DSP_DEFAULT,s\.fx\|\|\{\}\)/);
  assert.match(craft, /loadT3KModel\(slot\.slot,slot\.tone,slot\.model\)/);
  assert.match(craft, /nam8\.setSlotFx\(slot\.slot,fx\)/);
  assert.match(craft, /nam8\.setIRFx\(slot\.slot,fx\)/);
  assert.match(craft, /'R1'/);
  assert.match(craft, /'R2'/);
  assert.match(craft, /'R3'/);
  assert.match(craft, /'IR1'/);
});

test('Build 988 HTML, modules and numbered/latest pages share the same release version', () => {
  const base = path.join(ROOT, 'tone3000');
  const html = fs.readFileSync(path.join(base, 'builds/app-988.html'), 'utf8');
  const latest = fs.readFileSync(path.join(base, 'builds/app-latest.html'), 'utf8');
  const versions = [
    ['modules/rhymelight/rhymelight.js', /var VERSION = '([^']+)'/],
    ['modules/voice2guitar/voice2guitar.js', /const VERSION='([^']+)'/],
    ['modules/rig/rig.js', /var MODULE_VERSION = '([^']+)'/],
    ['modules/nam/nam.js', /var MODULE_VERSION = '([^']+)'/],
    ['modules/tonecraftai/tonecraftai.js', /const VERSION='([^']+)'/]
  ];
  assert.equal(html, latest, 'app-988.html and app-latest.html are byte-identical');
  assert.match(html, /window\.BUILD='4\.9\.8\.988'/);
  for (const [file, re] of versions) {
    const source = fs.readFileSync(path.join(base, file), 'utf8');
    assert.equal(source.match(re)?.[1], '4.9.8.988', file + ' version matches app');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'modules/rhymelight/rhymelight.json'), 'utf8'));
  assert.equal(manifest.version, '4.9.8.988');
});

test('Voice2Guitar low-note pitch estimator detects a synthetic C3 signal', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tone3000/modules/voice2guitar/voice2guitar.js'), 'utf8');
  const sandbox = {
    window: { __MODULES: {}, registerModule() {}, __IMPROVS_MIC_POOL: { acquire(){}, release(){} } },
    document: { readyState: 'loading', addEventListener() {} }, navigator: {},
    localStorage: { getItem(){ return null; }, setItem(){} }, performance: { now(){ return 0; } },
    console, setTimeout(){ return 1; }, clearTimeout(){}, PointerEvent: undefined,
    Event: function(){}, Blob, URL, TextEncoder, TextDecoder, Map, Set, Math, Date,
    confirm(){ return false; }, prompt(){ return null; }
  };
  vm.runInNewContext(source, sandbox, { filename: 'voice2guitar.js' });
  const { estimatePitch } = sandbox.window.__voice2guitarTest;
  const sampleRate = 48000, targetHz = 130.8128, buffer = new Float32Array(4096);
  for (let i=0;i<buffer.length;i++) buffer[i] = 0.2*Math.sin(2*Math.PI*targetHz*i/sampleRate);
  const detected = estimatePitch(buffer, sampleRate);
  assert.ok(detected.hz > 0);
  assert.ok(Math.abs(detected.hz-targetHz)/targetHz < 0.03, 'C3 estimate stays within 3%');
  assert.ok(detected.confidence > 0.9);
});

test('ToneCraftAI derives a blues-rock plan and model-specific slot FX from the prompt', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tone3000/modules/tonecraftai/tonecraftai.js'), 'utf8');
  let api;
  const sandbox = { window: { registerModule(name, value){ assert.equal(name, 'tonecraftai'); api=value; } }, console };
  vm.runInNewContext(source, sandbox, { filename: 'tonecraftai.js' });
  const plan = api.inferTone('Warm blues-rock lead with singing sustain, gritty controlled breakup and tight bass.');
  assert.ok(plan.tags.includes('blues'));
  assert.ok(plan.third.enabled, 'extra stage is suggested when sustain is requested');
  for (const slot of ['R1','R2','R3','IR1']) assert.ok(plan.fx[slot]);
  assert.ok(plan.fx.R1.drive > 0);
  assert.ok(plan.fx.IR1.highCut > 0);
});
