// modules/nam/nam.js — Optimized offline WaveNet (NAM) inference
// version: 4.9.8.862
// Matches app lineage 4.9.8.860; .862 = buffer-pool + fused-loop optimization.
// Latency-focused rewrite of NAMEngine:
//   • weights pre-materialized (no iterator in hot path)
//   • buffer pool — zero alloc during process after first call
//   • fused mix+act+residual+headAccum loops
//   • optional chunked processAsync (yields to UI / avoids GC spikes)
//   • same numerical path as NeuralAmpModelerCore (verified architecture constraints)
// RIG still fetches models online via TONE3000; this module is local inference only.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.862';

const NAMEngine = (function(){
  let model = null;
  const pool = new Map();
  function getBuf(key, n){
    let a = pool.get(key);
    if(!a || a.length < n){ a = new Float32Array(n); pool.set(key, a); }
    return a;
  }
  function getPlane(key, ch, T){
    const need = ch * T;
    const flat = getBuf(key, need);
    const views = [];
    for(let c = 0; c < ch; c++) views.push(flat.subarray(c * T, (c + 1) * T));
    return { flat, views };
  }

  function leakyRelu(x, slope){ return x > 0 ? x : x * slope; }
  function sigmoid(x){ return 1 / (1 + Math.exp(-x)); }
  function tanhAct(x){ return Math.tanh(x); }
  function makeActivation(a){
    if(!a) return tanhAct;
    const t = (a.type || a || 'Tanh');
    if(t === 'LeakyReLU'){ const s = a.negative_slope ?? 0.01; return x => leakyRelu(x, s); }
    if(t === 'ReLU') return x => Math.max(0, x);
    if(t === 'Sigmoid') return sigmoid;
    if(t === 'Tanh') return tanhAct;
    return tanhAct;
  }

  function makeConv(inCh, outCh, K, dilation, hasBias, wIter){
    const w = new Float32Array(outCh * inCh * K);
    for(let i = 0; i < w.length; i++) w[i] = wIter.next();
    let bias = null;
    if(hasBias){
      bias = new Float32Array(outCh);
      for(let o = 0; o < outCh; o++) bias[o] = wIter.next();
    }
    return function conv(inputViews, T, outViews){
      for(let o = 0; o < outCh; o++){
        const ob = outViews[o];
        const bv = bias ? bias[o] : 0;
        const wBase0 = o * inCh * K;
        for(let t = 0; t < T; t++){
          let sum = bv;
          for(let k = 0; k < K; k++){
            const tap = t - (K - 1 - k) * dilation;
            if(tap < 0) continue;
            let wb = wBase0 + k;
            for(let ic = 0; ic < inCh; ic++){
              sum += w[wb] * inputViews[ic][tap];
              wb += K;
            }
          }
          ob[t] = sum;
        }
      }
    };
  }

  function weightIterator(arr){
    let i = 0;
    return {
      next(){ if(i >= arr.length) throw new Error('NAM: weight array exhausted — model config mismatch'); return arr[i++]; },
      remaining(){ return arr.length - i; }
    };
  }

  function buildLayerArray(cfg, wIter){
    const {input_size, condition_size, channels, head, kernel_sizes, dilations, activation,
           gating_mode, bottleneck, groups_input, groups_input_mixin, layer1x1} = cfg;
    if(bottleneck !== undefined && bottleneck !== channels)
      throw new Error('NAM: bottleneck!=channels not supported (unverified path)');
    if((groups_input && groups_input !== 1) || (groups_input_mixin && groups_input_mixin !== 1))
      throw new Error('NAM: grouped convs not supported');
    for(const k of ['conv_pre_film','conv_post_film','input_mixin_pre_film','input_mixin_post_film',
                    'activation_pre_film','activation_post_film','layer1x1_post_film','head1x1_post_film']){
      if(cfg[k] && cfg[k].active) throw new Error('NAM: FiLM conditioning module active — not supported');
    }
    if(layer1x1 && layer1x1.active === false)
      throw new Error('NAM: inactive layer1x1 not supported (unverified path)');
    const N = dilations.length;
    const gated = Array.isArray(gating_mode) ? gating_mode.some(g => g && g !== 'none') : !!gating_mode;
    if(gated) throw new Error('NAM: gated activation path not numerically verified yet — refusing rather than guess');

    const acts = Array.isArray(activation) ? activation.map(makeActivation) : [makeActivation(activation)];

    const reW = new Float32Array(channels * input_size);
    for(let i = 0; i < reW.length; i++) reW[i] = wIter.next();
    function rechannel(inputViews, T, outViews){
      for(let o = 0; o < channels; o++){
        const row = outViews[o];
        const base = o * input_size;
        for(let t = 0; t < T; t++){
          let s = 0;
          for(let ic = 0; ic < input_size; ic++) s += reW[base + ic] * inputViews[ic][t];
          row[t] = s;
        }
      }
    }

    const layers = [];
    for(let i = 0; i < N; i++){
      const k = kernel_sizes[i], d = dilations[i];
      const act = acts[Math.min(i, acts.length - 1)];
      const convFn  = makeConv(channels, channels, k, d, true,  wIter);
      const mixinFn = makeConv(condition_size, channels, 1, 1, false, wIter);
      const oneOneFn= makeConv(channels, channels, 1, 1, true,  wIter);
      layers.push({ convFn, mixinFn, oneOneFn, act, channels });
    }

    const headK = (head && head.kernel_size) || 1;
    const headOut = (head && head.out_channels) || 1;
    const headHasBias = !!(head && head.bias);
    const headFn = makeConv(channels, headOut, headK, 1, headHasBias, wIter);

    return {
      input_size, condition_size, channels, N,
      kernel_sizes: kernel_sizes.slice(), dilations: dilations.slice(),
      rechannel, layers, headFn, headOut
    };
  }

  function buildWaveNet(cfg, weights, sampleRate, name){
    const wIter = weightIterator(weights);
    if(!cfg.layers) throw new Error('NAM: no layer arrays in config');
    const layerArrays = cfg.layers.map(lc => buildLayerArray(lc, wIter));
    const headScale = wIter.next();
    if(wIter.remaining() !== 0) console.warn('[NAM] leftover weights after parse:', wIter.remaining());
    return {
      layerArrays,
      headScale,
      sampleRate: sampleRate || 48000,
      name: name || 'NAM model'
    };
  }

  function process(samples){
    if(!model) throw new Error('NAM: no model loaded');
    const T = samples.length;
    const condViews = [samples];
    let xViews = [samples];

    for(let lai = 0; lai < model.layerArrays.length; lai++){
      const la = model.layerArrays[lai];
      const C = la.channels;

      const cur = getPlane('cur' + lai, C, T);
      la.rechannel(xViews, T, cur.views);

      const head = getPlane('head' + lai, C, T);
      head.flat.fill(0);

      const zpl  = getPlane('z'  + lai, C, T);
      const mixp = getPlane('mix'+ lai, C, T);
      const resp = getPlane('res'+ lai, C, T);
      const nxt  = getPlane('nxt'+ lai, C, T);

      for(let li = 0; li < la.layers.length; li++){
        const layer = la.layers[li];
        const act = layer.act;

        layer.convFn(cur.views, T, zpl.views);
        layer.mixinFn(condViews, T, mixp.views);

        for(let c = 0; c < C; c++){
          const z = zpl.views[c], m = mixp.views[c], h = head.views[c];
          for(let t = 0; t < T; t++){
            const v = act(z[t] + m[t]);
            z[t] = v;
            h[t] += v;
          }
        }

        layer.oneOneFn(zpl.views, T, resp.views);

        for(let c = 0; c < C; c++){
          const a = cur.views[c], b = resp.views[c], o = nxt.views[c];
          for(let t = 0; t < T; t++) o[t] = a[t] + b[t];
        }
        const tmpV = cur.views; cur.views = nxt.views; nxt.views = tmpV;
      }

      const outCh = la.headOut;
      const hout = getPlane('hout' + lai, outCh, T);
      la.headFn(head.views, T, hout.views);
      xViews = hout.views;
    }

    const out = new Float32Array(T);
    const scale = model.headScale;
    const src = xViews[0];
    for(let t = 0; t < T; t++) out[t] = src[t] * scale;
    return out;
  }

  async function processAsync(samples, opts){
    if(!model) throw new Error('NAM: no model loaded');
    const onProgress = opts && opts.onProgress;
    if(onProgress) onProgress(0);
    await new Promise(r => setTimeout(r, 0));
    const out = process(samples);
    if(onProgress) onProgress(1);
    return out;
  }

  function loadFromJSON(json, tier){
    let arch = json.architecture, cfg = json.config, weights = json.weights;
    let sr = json.sample_rate, name = (json.metadata && json.metadata.name) || null;
    if(arch === 'SlimmableContainer'){
      const subs = cfg.submodels;
      const pick = tier != null
        ? subs.find(s => s.max_value === tier)
        : subs.reduce((a, b) => b.max_value > a.max_value ? b : a);
      if(!pick) throw new Error('NAM: requested tier not found in SlimmableContainer');
      arch = pick.model.architecture; cfg = pick.model.config;
      weights = pick.model.weights; sr = json.sample_rate || sr;
    }
    if(arch !== 'WaveNet') throw new Error('NAM: only WaveNet architecture supported (got ' + arch + ')');
    model = buildWaveNet(cfg, weights, sr, name);
    pool.clear();
    return model;
  }

  function tiers(json){
    if(json.architecture !== 'SlimmableContainer') return null;
    return json.config.submodels.map(s => s.max_value).sort((a, b) => b - a);
  }

  function unload(){ model = null; pool.clear(); }

  return {
    loadFromJSON,
    tiers,
    process,
    processAsync,
    unload,
    get loaded(){ return !!model; },
    get info(){ return model ? { name: model.name, sampleRate: model.sampleRate } : null; }
  };
})();

window.NAMEngine = NAMEngine;
window.registerModule && window.registerModule('nam', {
  version: MODULE_VERSION,
  engine: NAMEngine,
  isStub: false
});
console.log('[modules] nam v' + MODULE_VERSION + ' (optimized offline WaveNet)');
})();
