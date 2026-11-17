const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const rigPath = path.join(__dirname, '..', 'tone3000', 'modules', 'rig', 'rig.js');
const rigSource = fs.readFileSync(rigPath, 'utf8');
const namPath = path.join(__dirname, '..', 'tone3000', 'modules', 'nam', 'nam.js');
const namSource = fs.readFileSync(namPath, 'utf8');
const appBuildPath = path.join(__dirname, '..', 'tone3000', 'builds', 'app-987.html');
const appLatestPath = path.join(__dirname, '..', 'tone3000', 'builds', 'app-latest.html');
const rootLatestPath = path.join(__dirname, '..', 'tone3000', 'app-latest.html');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be implemented in rig.js`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

function loadProcessor() {
  const match = rigSource.match(/const PROCESSOR_SRC\s*=\s*`([\s\S]*?)\n`;/);
  assert.ok(match, 'rig.js must contain its AudioWorklet processor source');
  const processors = {};
  let clock = 0;
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } };
    }
  }
  class FakeWebAssemblyInstance {
    constructor() {
      const buffer = new ArrayBuffer(16 * 1024);
      const memF = new Float32Array(buffer);
      this.exports = {
        m: { buffer },
        p(n) { for (let i = 0; i < n; i++) memF[1024 + i] = memF[i]; }
      };
    }
  }
  const context = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    WebAssembly: { Instance: FakeWebAssemblyInstance },
    Float32Array, Int32Array, Array, Math, Number, String, Error,
    sampleRate: 48000,
    performance: { now() { clock += 0.05; return clock; } },
    registerProcessor(name, ctor) { processors[name] = ctor; },
    console
  };
  vm.runInNewContext(match[1], context, { timeout: 1000 });
  assert.ok(processors['nam-processor'], 'NAM AudioWorklet processor should register');
  return processors['nam-processor'];
}

test('NAM block size produces one 128-frame host quantum at supported sample rates', () => {
  const fn = vm.runInNewContext(`(${extractFunction(rigSource, 'blockSizeForQuantum')})`);
  const cases = [
    [24000, 48000, 64],
    [44100, 48000, 118],
    [48000, 48000, 128],
    [96000, 48000, 256],
    [192000, 48000, 512],
    [44100, 44100, 128]
  ];
  for (const [modelRate, hostRate, expected] of cases) {
    const block = fn(modelRate, hostRate, 128);
    assert.equal(block, expected, `${modelRate} Hz model on ${hostRate} Hz host`);
    assert.equal(Math.round(block * hostRate / modelRate), 128, 'one model block must map to one host quantum');
  }
  assert.throws(() => fn(0, 48000, 128), /invalid sample rate/);
  assert.throws(() => fn(192000, 8000, 128), /1024-sample WASM I\/O window/);
});

test('NAM worklet keeps a constant wet stream continuous instead of outputting zero gaps', () => {
  const Processor = loadProcessor();
  const processor = new Processor();
  processor.port.onmessage({ data: {
    type: 'model', module: {}, modelRate: 48000, blockSize: vm.runInNewContext(`(${extractFunction(rigSource, 'blockSizeForQuantum')})`)(48000, 48000, 128),
    layout: { ioIn: 0, ioOut: 1024, writesF: [], writesI: [] }
  }});
  const outputSamples = [];
  for (let frame = 0; frame < 10; frame++) {
    const input = new Float32Array(128).fill(0.25);
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    processor.process([[input]], [[left, right]]);
    outputSamples.push(...left);
  }
  assert.equal(outputSamples.length, 1280);
  assert.ok(outputSamples.every(Number.isFinite), 'all rendered samples must be finite');
  assert.ok(Math.min(...outputSamples) > 0.15, 'startup and steady-state output must not contain silent gaps');
  assert.ok(Math.max(...outputSamples.slice(256)) < 0.35, 'steady-state output must remain bounded');
  assert.equal(processor._streamReady, true, 'stream should remain primed');
  assert.ok(processor._srcQ.length < 2 * 128, 'source queue must not grow from under-consumption');
});


test('NAM worklet keeps a 24 kHz capture continuous on a 48 kHz host', () => {
  const Processor = loadProcessor();
  const processor = new Processor();
  const helper = vm.runInNewContext(`(${extractFunction(rigSource, 'blockSizeForQuantum')})`);
  processor.port.onmessage({ data: {
    type: 'model', module: {}, modelRate: 24000, blockSize: helper(24000, 48000, 128),
    layout: { ioIn: 0, ioOut: 1024, writesF: [], writesI: [] }
  }});
  const samples = [];
  for (let frame = 0; frame < 12; frame++) {
    const input = new Float32Array(128).fill(0.125);
    const left = new Float32Array(128);
    processor.process([[input]], [[left]]);
    samples.push(...left);
  }
  assert.ok(samples.every(Number.isFinite));
  assert.ok(Math.min(...samples.slice(512)) > 0.05, 'steady resampled output must not have silent gaps');
  assert.equal(processor._streamReady, true);
  assert.ok(processor._srcQ.length < 2 * 128, 'resampling queue must stay bounded');
});

test('Build 987 rig keeps eight NAM and four serial IR slots and uses the quantum block helper', () => {
  assert.match(rigSource, /const NAM_KEYS=\['R1','R2','R3','R4','R5','R6','R7','R8'\]/);
  assert.match(rigSource, /const IR_KEYS=\['IR1','IR2','IR3','IR4'\]/);
  assert.match(rigSource, /blockSize=window\.NAMRealtime\.blockSizeForQuantum\(modelRate,hostRate,128\)/);
  assert.match(rigSource, /st\.workletStatus='REUSING WASM'/);
  assert.doesNotMatch(rigSource, /modelRate=Number\(spec\.sampleRate\),blockSize=64/);
  assert.match(rigSource, /st\.cpuGuardBypass/);
});


test('Build 987 app, latest copies, and NAM runtime metadata agree', () => {
  const build = fs.readFileSync(appBuildPath);
  assert.deepEqual(fs.readFileSync(appLatestPath), build);
  assert.deepEqual(fs.readFileSync(rootLatestPath), build);
  const app = build.toString('utf8');
  assert.match(app, /IMPROVS2 BUILD 987/);
  assert.match(app, /window\.BUILD='4\.9\.8\.987'/);
  assert.match(app, /987-rate-matched-nam-guard-r1/);
  assert.match(app, /TONE3000 OTP/);
  assert.match(app, /Rhymelight grade-first/);
  assert.match(rigSource, /MODULE_VERSION = '4\.9\.8\.987'/);
  assert.match(rigSource, /VERSION='4\.9\.8\.987'/);
  assert.match(namSource, /MODULE_VERSION = '4\.9\.8\.987'/);
});
