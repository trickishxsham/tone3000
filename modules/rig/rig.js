// modules/rig/rig.js
// version: 4.9.8.930-two-nam-budget
// Legacy NAMRealtime compatibility layer + eight-slot serial NAM rig and four serial IR slots
// Fetches models online from tone3000.com; inference runs locally.
// Depends on: NAMEngine (modules/nam) for offline / _namActive check.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.929';
var _booted=false;
var _uiBound=false;

function boot(){
if(_booted) return; _booted=true;
// ─── REALTIME NAM v2 (build 588) — WaveNet compiled to WASM on the MAIN thread, shipped
//   into the AudioWorklet as a precompiled WebAssembly.Module. Three fixes vs v1:
//   1) FULL CHAIN — every layer-array is emitted and chained inside one WASM function.
//      (v1 silently ran only layerArrays[0]; standard 2-array NAM captures — i.e. nearly
//      everything on TONE3000 — rendered WRONG in realtime while offline was correct.)
//   2) NO AUDIO-THREAD COMPILE — bytecode emission + WebAssembly.compile run on the main
//      thread; the worklet only instantiates (cheap) and swaps models at a block boundary
//      with a 128-sample dry→wet crossfade. Loading/switching a model mid-play can no
//      longer starve the render thread.
//   3) BLOCK CALLS — one WASM call per render block via a shared io region, instead of one
//      JS→WASM boundary crossing per sample (was ~96k calls/sec with pedal+amp).
//   Also: ring size is now computed from max dilation lookback (pow2) instead of a fixed
//   4096 — halves worklet memory for standard captures and refuses nothing it supported.
//   Same verified math as NAMEngine. Rejects gated/bottleneck/grouped/FiLM/mixed-slope
//   (unverified paths — refuse rather than render silently-wrong audio).
const NAMRealtime = (function(){
  let nodePedal=null, nodeAmp=null, ac=null, active=false, ready=false;
  // Per-slot GATEWAY-style DSP: input gain -> noise gate -> [NAM] -> bass/mid/treble EQ -> output gain.
  const fx={ pedal:null, amp:null, cab:null };
  let _rigVerb=null, _rigVerbSum=null;      // shared reverb for GATEWAY wet sends
  function makeDriveCurve(amount){
    // amount 0..10 -> tanh saturation. 0 = near-linear. Curve is odd-symmetric for musical clip.
    const k=amount*8;                        // drive gain into the shaper
    const n=1024, curve=new Float32Array(n);
    for(let i=0;i<n;i++){ const x=(i/(n-1))*2-1; curve[i]=k<0.001? x : Math.tanh(k*x)/Math.tanh(k||1); }
    return curve;
  }
  function ensureRigVerb(context){
    if(_rigVerb) return;
    const len=Math.floor(context.sampleRate*1.8);      // slightly longer tail than global — pedal-verb feel
    const imp=context.createBuffer(2,len,context.sampleRate);
    for(let ch=0;ch<2;ch++){ const d=imp.getChannelData(ch);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6); }
    _rigVerb=context.createConvolver(); _rigVerb.buffer=imp; _rigVerb.normalize=true;
    _rigVerbSum=context.createGain(); _rigVerbSum.gain.value=1;
    _rigVerb.connect(_rigVerbSum);
  }
  function buildFx(context){
    ensureRigVerb(context);
    function mk(){
      const inGain=context.createGain(); inGain.gain.value=1;
      const drive=context.createWaveShaper(); drive.curve=makeDriveCurve(0); drive.oversample='2x';
      const gate=context.createDynamicsCompressor(); // retained only for legacy snapshot compatibility; not exposed in UI
      gate.threshold.value=-80; gate.knee.value=0; gate.ratio.value=20; gate.attack.value=0.003; gate.release.value=0.15;
      const comp=context.createDynamicsCompressor(); comp.threshold.value=-24; comp.knee.value=18; comp.ratio.value=2.5; comp.attack.value=0.01; comp.release.value=0.12;
      const lowCut=context.createBiquadFilter(); lowCut.type='highpass'; lowCut.frequency.value=35; lowCut.Q.value=0.707;
      const bass=context.createBiquadFilter(); bass.type='lowshelf'; bass.frequency.value=120; bass.gain.value=0;
      const mid=context.createBiquadFilter(); mid.type='peaking'; mid.frequency.value=800; mid.Q.value=0.7; mid.gain.value=0;
      const treble=context.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000; treble.gain.value=0;
      const highCut=context.createBiquadFilter(); highCut.type='lowpass'; highCut.frequency.value=18000; highCut.Q.value=0.707;
      const outGain=context.createGain(); outGain.gain.value=1;
      const wetSend=context.createGain(); wetSend.gain.value=0; // separate restrained shared reverb send; defaults dry
      wetSend.connect(_rigVerb);
      return { inGain, drive, gate, comp, lowCut, bass, mid, treble, highCut, outGain, wetSend, gateOn:false, compOn:false, eqOn:true, driveAmt:0 };
    }
    if(!fx.pedal){ fx.pedal=mk(); fx.amp=mk(); fx.cab=mk(); }
  }
  let pendingPedal=null, pendingAmp=null;
  function _xfer(m){ return m.layout.writesF.map(w=>w.data.buffer).concat(m.layout.writesI.map(w=>w.data.buffer)); }
  async function addModuleOnce(context){
    if(context._namModuleLoaded) return;
    if(context._namModuleLoading) return context._namModuleLoading;
    // v578: the old loader marked the module LOADED even when BOTH addModule attempts
    //   threw ("already registered ok"), so ks-processor was never registered and the
    //   only symptom was a misleading "node name 'ks-processor' is not defined" later.
    //   Now: try data: -> blob: -> same-origin blob(text/javascript). Only mark loaded
    //   when an attempt actually succeeds; on total failure clear the in-flight promise
    //   so the next pluck retries instead of failing forever.
    context._namModuleLoading=(async()=>{
      const errs=[];
      const tryUrl=async(url,revoke)=>{
        try{ await context.audioWorklet.addModule(url); return true; }
        catch(e){ errs.push(e&&e.message||String(e)); return false; }
        finally{ if(revoke) try{ URL.revokeObjectURL(url); }catch(e){} }
      };
      let ok=false;
      try{ ok=await tryUrl('data:application/javascript;base64,'+btoa(unescape(encodeURIComponent(PROCESSOR_SRC)))); }
      catch(e){ errs.push('data-url build: '+(e&&e.message)); }
      if(!ok){ try{ ok=await tryUrl(URL.createObjectURL(new Blob([PROCESSOR_SRC],{type:'application/javascript'})),true); }catch(e){ errs.push('blob: '+(e&&e.message)); } }
      if(!ok){ try{ ok=await tryUrl(URL.createObjectURL(new Blob([PROCESSOR_SRC],{type:'text/javascript'})),true); }catch(e){ errs.push('blob-text: '+(e&&e.message)); } }
      // "already registered" means a previous call DID succeed — treat as loaded.
      if(!ok && errs.some(m=>/already/i.test(m||''))) ok=true;
      if(!ok){
        context._namModuleLoading=null;                       // allow a retry next time
        window._workletFailed=errs.join(' | ');
        console.error('[WORKLET] addModule failed — no processors registered:', window._workletFailed);
        throw new Error('worklet addModule failed: '+errs[errs.length-1]);
      }
      context._namModuleLoaded=true;
    })();
    return context._namModuleLoading;
  }
  window._namLoadModule=addModuleOnce;
  function wireNode(nd, slot){
    nd.port.onmessage=(e)=>{ if(e.data.type==='ready'){ ready=true; }
      else if(e.data.type==='processing'){ if(window._namRtProcessing) window._namRtProcessing(slot); }
      else if(e.data.type==='overrun'){ if(window._namRtOverrun) window._namRtOverrun(slot); }
      else if(e.data.type==='error'){ ready=false; console.warn('[NAM rt '+slot+']',e.data.msg); if(window._namRtOnError) window._namRtOnError(e.data.msg,slot); } };
  }
  async function ensurePedal(context){
    if(nodePedal) return nodePedal; ac=context; await addModuleOnce(context);
    nodePedal=new AudioWorkletNode(ac,'nam-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    wireNode(nodePedal,'pedal');
    if(pendingPedal){ const m=pendingPedal; pendingPedal=null; nodePedal.port.postMessage(m,_xfer(m)); }
    return nodePedal;
  }
  async function ensureAmp(context){
    if(nodeAmp) return nodeAmp; ac=context; await addModuleOnce(context);
    nodeAmp=new AudioWorkletNode(ac,'nam-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    wireNode(nodeAmp,'amp');
    if(pendingAmp){ const m=pendingAmp; pendingAmp=null; nodeAmp.port.postMessage(m,_xfer(m)); }
    return nodeAmp;
  }

  // Chain: INSTVOL -> [pedal] -> [ampIn gain -> amp] -> [cab] -> dest. Each stage optional.
  let _pedalOn=false, _ampOn=false, _irOn=false, _ctx=null, srcNode=null, dstNode=null;
  async function route(pedalOn, ampOn, irOn){
    // v861-lite20b: commit desired on-state FIRST so OFF/ON UI never sticks if graph throws.
    _pedalOn=!!pedalOn; _ampOn=!!ampOn; _irOn=!!irOn; active=_pedalOn||_ampOn||_irOn;
    try{ if(typeof window.ensureAudio==='function') window.ensureAudio(); }catch(e){}
    _ctx=_ctx||(window.getAC&&window.getAC())||window._AC||null;
    const ac2=_ctx;
    if(!ac2){
      console.warn('[rig] route: no AudioContext — state set, graph deferred');
      return;
    }
    try{ if(ac2.state==='suspended') await ac2.resume(); }catch(e){}
    buildFx(ac2);
    const src=window._namMasterNode||window._INSTVOL||null;
    const dst=(window._MASTERCLIP||ac2.destination);
    const cab=window._IRCAB, comp=window._COMP_NODE;
    if(!src){
      console.warn('[rig] route: no _namMasterNode yet — state set, graph deferred');
      return;
    }
    try{
      if(_pedalOn) await ensurePedal(ac2);
      if(_ampOn) await ensureAmp(ac2);
    }catch(e){
      console.warn('[rig] ensurePedal/Amp failed', e&&e.message||e);
      // keep on-state so UI reflects intent; audio may be dry until retry
    }
    // tear down every node's outputs
    try{ src.disconnect(); }catch(e){}
    for(const k of ['pedal','amp','cab']){ const f=fx[k]; if(!f)continue;
      for(const n of [f.inGain,f.drive,f.gate,f.comp,f.lowCut,f.bass,f.mid,f.treble,f.highCut,f.outGain,f.wetSend]){ try{n.disconnect();}catch(e){} } }
    try{ if(nodePedal) nodePedal.disconnect(); }catch(e){}
    try{ if(nodeAmp) nodeAmp.disconnect(); }catch(e){}
    try{ if(cab) cab.disconnect(); }catch(e){}
    try{ if(_rigVerb) _rigVerb.disconnect(); }catch(e){}
    try{ if(_rigVerbSum) _rigVerbSum.disconnect(); }catch(e){}
    // wetSend feeds the shared reverb (re-established after teardown)
    for(const k of ['pedal','amp','cab']){ const f=fx[k]; if(f&&_rigVerb) try{ f.wetSend.connect(_rigVerb); }catch(e){} }
    if(_rigVerb && _rigVerbSum) try{ _rigVerb.connect(_rigVerbSum); }catch(e){}
    // helper: wire one slot's fx around a processing node. Returns tail.
    // chain: prev -> input -> drive -> [compressor] -> NAM/IR -> low-cut -> EQ -> high-cut -> output; reverb is parallel send
    function wireSlot(prev, f, node){
      if(!prev || !f) return prev;
      prev.connect(f.inGain);
      f.inGain.connect(f.drive);
      let t=f.drive;
      if(f.compOn){ t.connect(f.comp); t=f.comp; }
      if(node){ t.connect(node); t=node; }
      t.connect(f.lowCut); t=f.lowCut;
      if(f.eqOn){ t.connect(f.bass); f.bass.connect(f.mid); f.mid.connect(f.treble); t=f.treble; }
      t.connect(f.highCut); t=f.highCut;
      t.connect(f.outGain);
      f.outGain.connect(f.wetSend);
      return f.outGain;
    }
    try{
      let tail=src;
      if(_pedalOn){ tail=wireSlot(tail, fx.pedal, nodePedal); }
      if(_ampOn){ tail=wireSlot(tail, fx.amp, nodeAmp); }
      if(_irOn && cab){ tail=wireSlot(tail, fx.cab, cab); }
      if(_pedalOn||_ampOn||_irOn){ tail.connect(dst); if(_rigVerbSum) try{ _rigVerbSum.connect(dst); }catch(e){} }
      else { if(comp){ src.connect(comp); } else { src.connect(dst); } }
    }catch(e){
      console.warn('[rig] graph wire failed', e&&e.message||e);
      // restore dry path so audio isn't silent
      try{ src.disconnect(); }catch(e2){}
      try{ if(comp) src.connect(comp); else src.connect(dst); }catch(e2){}
    }
    srcNode=src; dstNode=dst;
  }
  // parameter setters per slot
  function setParam(slot, param, value){
    const f=fx[slot]; if(!f) return;
    if(param==='input') f.inGain.gain.value=Math.pow(10,value/20);
    else if(param==='output') f.outGain.gain.value=Math.pow(10,value/20);
    else if(param==='lowCut') f.lowCut.frequency.value=Math.max(20,Math.min(1000,value));
    else if(param==='highCut') f.highCut.frequency.value=Math.max(1000,Math.min(20000,value));
    else if(param==='bassFreq') f.bass.frequency.value=Math.max(40,Math.min(500,value));
    else if(param==='midFreq') f.mid.frequency.value=Math.max(100,Math.min(8000,value));
    else if(param==='midQ') f.mid.Q.value=Math.max(0.3,Math.min(5,value));
    else if(param==='trebleFreq') f.treble.frequency.value=Math.max(1000,Math.min(12000,value));
    else if(param==='compThreshold') f.comp.threshold.value=value;
    else if(param==='compRatio') f.comp.ratio.value=Math.max(1,Math.min(12,value));
    else if(param==='compAttack') f.comp.attack.value=Math.max(0.001,Math.min(0.2,value));
    else if(param==='compRelease') f.comp.release.value=Math.max(0.02,Math.min(1,value));
    else if(param==='bass') f.bass.gain.value=(value-5)*3;
    else if(param==='middle') f.mid.gain.value=(value-5)*3;
    else if(param==='treble') f.treble.gain.value=(value-5)*3;
    else if(param==='drive'){ f.driveAmt=value; f.drive.curve=makeDriveCurve(value); }
    else if(param==='reverb') f.wetSend.gain.value=Math.max(0,Math.min(0.35,value/100));
  }
  function setFxEnabled(slot, which, on){
    const f=fx[slot]; if(!f) return;
    if(which==='gate') f.gateOn=false; // legacy snapshot field accepted; gate intentionally absent from current UI
    else if(which==='compressor') f.compOn=!!on;
    else if(which==='eq') f.eqOn=!!on;
    route(_pedalOn,_ampOn,_irOn);
  }
  // ── main-thread model build: flatten -> emit WASM bytes -> async compile -> post module.
  //   A token per slot means a rapid second load supersedes the first (no stale swap).
  const _buildTok={pedal:0, amp:0};
  async function setModel(slot,json,tier){
    const tok=++_buildTok[slot];
    try{
      const spec=flattenModel(json,tier);
      const em=emitChain(spec);
      const module=await WebAssembly.compile(em.bytes);
      if(tok!==_buildTok[slot]) return;                    // superseded
      const msg={type:'model', module, layout:em.layout, modelRate:Number(spec.sampleRate)||Number(ac&&ac.sampleRate)||44100};
      if(slot==='pedal'){ if(nodePedal){ ready=false; nodePedal.port.postMessage(msg,_xfer(msg)); } else pendingPedal=msg; }
      else { if(nodeAmp){ ready=false; nodeAmp.port.postMessage(msg,_xfer(msg)); } else pendingAmp=msg; }
    }catch(err){
      console.warn('[NAM rt build '+slot+']', err&&err.message);
      if(window._namRtOnError) window._namRtOnError(err&&err.message, slot);
    }
  }
  function setBypass(slot,v){ const nd=slot==='pedal'?nodePedal:nodeAmp; if(nd) nd.port.postMessage({type:'bypass',value:!!v}); }
  function setInputGain(v){ if(window._NAMIN) window._NAMIN.gain.value=v; }
  function setIR(buffer){ if(window._IRCAB) window._IRCAB.buffer=buffer; }

  // ── WASM emitter (MAIN THREAD). One module = the whole layer-array chain, per sample,
  //   wrapped in a block loop over a shared io region. Memory map is computed here and
  //   returned in layout.writes* so the worklet only copies typed arrays into place.
  function emitChain(spec){
    function uleb(n){const b=[];n>>>=0;do{let x=n&127;n>>>=7;if(n)x|=128;b.push(x);}while(n);return b;}
    function sleb(n){n|=0;const b=[];let m=1;while(m){let x=n&127;n>>=7;if((n===0&&!(x&64))||(n===-1&&(x&64)))m=0;else x|=128;b.push(x);}return b;}
    function sec(id,p){return[id,...uleb(p.length),...p];}
    function vec(items){return[...uleb(items.length),...items.flat()];}
    function str(s){const b=[];for(let i=0;i<s.length;i++)b.push(s.charCodeAt(i));return[...uleb(b.length),...b];}
    const F32=125,I32=127;
    const G=i=>[32,...uleb(i)],S=i=>[33,...uleb(i)],TEE=i=>[34,...uleb(i)];
    const IC=n=>[65,...sleb(n)];
    const FC=f=>{const b=new ArrayBuffer(4);new DataView(b).setFloat32(0,f,true);return[67,...new Uint8Array(b)];};
    const FL=[42,2,0],FST=[56,2,0],IL=[40,2,0],IST=[54,2,0];
    const FMUL=[148],FADD=[146],FGT=[94],SEL=[27];
    const IADD=[106],ISUB=[107],IMUL=[108],IREM=[111],ISHL2=[...IC(2),116];
    const ILT=[72],END=[11],BRIF=n=>[13,...uleb(n)];
    const body=[];
    const P=(...parts)=>{ for(const p of parts) for(const b of p) body.push(b); };   // linear-time emit (v1 was quadratic)

    // validate + ring size: smallest pow2 covering max dilation lookback (v1 fixed 4096)
    if(spec.layerArrays[0].inputSize!==1) throw new Error('realtime NAM: first layer-array input_size!=1');
    let need=8;
    for(const la of spec.layerArrays){
      if(la.condSize!==1) throw new Error('realtime NAM: condition_size!=1 unsupported');
      if(!la.slopes.every(s=>s===la.slopes[0])) throw new Error('realtime NAM: mixed activation slopes unsupported');
      for(let i=0;i<la.dilations.length;i++) need=Math.max(need,(la.kernelSizes[i]-1)*la.dilations[i]+2);
      need=Math.max(need, la.headK+2);
    }
    let RING=256; while(RING<need) RING*=2;

    // memory layout (f32 indices)
    let idx=0;
    const IO_CAP=1024; const IO_IN=idx; idx+=IO_CAP; const IO_OUT=idx; idx+=IO_CAP;
    const S_cond=idx; idx+=1;                       // raw dry sample: la0 input AND every mixin's condition
    const writesF=[], writesI=[];
    const las=spec.layerArrays.map((la)=>{
      const r={la};
      r.Wb=idx; idx+=la.weights.length;
      r.hist=idx; idx+=la.dilations.length*la.channels*RING;
      r.headRing=idx; idx+=la.channels*RING;
      r.S_cur=idx; idx+=la.channels;
      r.S_z=idx; idx+=la.channels;
      r.S_res=idx; idx+=la.channels;
      r.S_head=idx; idx+=la.channels;
      r.S_out=idx; idx+=Math.max(1,la.headOut);
      r.RP=idx; idx+=la.dilations.length+1;         // per-layer ring pos + head ring pos
      r.PT=idx; idx+=la.dilations.length*7;
      return r;
    });
    // Match NAMEngine.process: the next layer-array consumes the previous array's
    // head output (xViews = hout.views). Channel counts may differ between arrays.
    for(let i=1;i<las.length;i++){
      if(las[i].la.inputSize!==las[i-1].la.headOut)
        throw new Error('realtime NAM: layer-array input size does not match previous head output');
    }
    const totalF32=idx;
    // per-la weight offsets + param table (written by the worklet via writesI)
    for(const r of las){
      const la=r.la, C=la.channels, N=la.dilations.length;
      let wp=r.Wb; r.rechO=wp; wp+=C*la.inputSize;
      const params=[];
      for(let i=0;i<N;i++){ const k=la.kernelSizes[i], d=la.dilations[i];
        const convO=wp; wp+=C*C*k; const convBO=wp; wp+=C; const mixO=wp; wp+=C*la.condSize;
        const oneO=wp; wp+=C*C; const oneBO=wp; wp+=C;
        params.push([k,d,convO,convBO,mixO,oneO,oneBO]); }
      r.headWO=wp; wp+=la.headOut*C*la.headK; r.headBO=la.headBias?wp:-1; if(la.headBias)wp+=la.headOut;
      r.params=params;
      writesF.push({off:r.Wb, data:la.weights});
      const pt=new Int32Array(N*7);
      for(let i=0;i<N;i++) for(let j=0;j<7;j++) pt[i*7+j]=params[i][j];
      writesI.push({off:r.PT, data:pt});
    }

    // locals: param0=n(i32); i32 locals 1..16; f32 local 17
    const LI=1,KERN=2,DIL=3,CONVO=4,CONVBO=5,MIXO=6,ONEO=7,ONEBO=8,HP=9,RI=10,KK=11,HISTL=14,SIDX=16,X=17;
    const LC=fi=>[...IC(fi),...ISHL2,...FL];
    const SC=(fi,c)=>[...IC(fi),...ISHL2,...c,...FST];
    const AI=(fi,c)=>[...IC(fi),...ISHL2,...LC(fi),...c,...FADD,...FST];

    // ===== BLOCK LOOP over io region =====
    P(IC(0),S(SIDX));
    P([3,64]); // loop (block)
      P(IC(IO_IN),G(SIDX),IADD,ISHL2,FL,S(X));      // X = io_in[s]
      P(SC(S_cond,G(X)));
      las.forEach((r,ai)=>{
        const la=r.la, C=la.channels, N=la.dilations.length;
        // Matches NAMEngine.process(): each array re-channels the previous array's
        // head output. The raw dry sample remains the conditioning input for every array.
        const inBase = ai===0 ? S_cond : las[ai-1].S_out;
        const slope=la.slopes[0];
        // rechannel: cur[c]=sum_ic rech[c*inputSize+ic]*in[ic] (small -> unroll)
        for(let c=0;c<C;c++){ P(SC(r.S_cur+c,FC(0)));
          for(let ic=0;ic<la.inputSize;ic++) P(AI(r.S_cur+c,[...LC(r.rechO+c*la.inputSize+ic),...LC(inBase+ic),...FMUL])); }
        for(let c=0;c<C;c++) P(SC(r.S_head+c,FC(0)));
        // ===== LAYER LOOP (dynamic over N) =====
        P(IC(0),S(LI));
        P([3,64]);
          const pget=(n)=>[...G(LI),...IC(7),...IMUL,...IC(r.PT+n),...IADD,...ISHL2,...IL];
          P(pget(0),S(KERN),pget(1),S(DIL),pget(2),S(CONVO),pget(3),S(CONVBO),pget(4),S(MIXO),pget(5),S(ONEO),pget(6),S(ONEBO));
          P(G(LI),IC(C*RING),IMUL,IC(r.hist),IADD,S(HISTL));
          P(G(LI),IC(r.RP),IADD,ISHL2,IL,IC(1),IADD,IC(RING),IREM,S(HP));
          P(G(LI),IC(r.RP),IADD,ISHL2,G(HP),IST);
          for(let c=0;c<C;c++) P(G(HISTL),G(HP),IC(C),IMUL,IC(c),IADD,IADD,ISHL2,LC(r.S_cur+c),FST);
          for(let oc=0;oc<C;oc++) P(SC(r.S_z+oc,[...G(CONVBO),...IC(oc),...IADD,...ISHL2,...FL]));
          P(IC(0),S(KK));
          P([3,64]); // loop kk
            P(G(HP), G(KERN),IC(1),ISUB,G(KK),ISUB,G(DIL),IMUL, ISUB,IC(RING),IADD,IC(RING),IREM,S(RI));
            for(let oc=0;oc<C;oc++) for(let ic=0;ic<C;ic++){
              const widx=[...G(CONVO),...IC(oc*C+ic),...G(KERN),...IMUL,...IADD,...G(KK),...IADD];
              const hidx=[...G(HISTL),...G(RI),...IC(C),...IMUL,...IC(ic),...IADD,...IADD];
              P(IC(r.S_z+oc),ISHL2, LC(r.S_z+oc), widx,ISHL2,FL, hidx,ISHL2,FL, FMUL, FADD, FST);
            }
            P(G(KK),IC(1),IADD,TEE(KK),G(KERN),ILT,BRIF(0));
          P([END]);
          // mixin (condSize==1, condition = raw dry sample — per NAM spec, NOT this la's input)
          for(let oc=0;oc<C;oc++)
            P(IC(r.S_z+oc),ISHL2,LC(r.S_z+oc), G(MIXO),IC(oc),IADD,ISHL2,FL, LC(S_cond),FMUL,FADD,FST);
          // leaky relu
          for(let c=0;c<C;c++) P(IC(r.S_z+c),ISHL2, LC(r.S_z+c), LC(r.S_z+c),FC(slope),FMUL, LC(r.S_z+c),FC(0),FGT,SEL, FST);
          for(let c=0;c<C;c++) P(AI(r.S_head+c,[...LC(r.S_z+c)]));
          for(let oc=0;oc<C;oc++){ P(SC(r.S_res+oc,[...G(ONEBO),...IC(oc),...IADD,...ISHL2,...FL]));
            for(let ic=0;ic<C;ic++) P(IC(r.S_res+oc),ISHL2,LC(r.S_res+oc), G(ONEO),IC(oc*C+ic),IADD,ISHL2,FL,LC(r.S_z+ic),FMUL,FADD,FST); }
          for(let c=0;c<C;c++) P(AI(r.S_cur+c,[...LC(r.S_res+c)]));
          P(G(LI),IC(1),IADD,TEE(LI),IC(N),ILT,BRIF(0));
        P([END]);
        // head ring push + head conv (unrolled) -> S_out (next la's input, or final)
        P(IC(r.RP+N),ISHL2,IL,IC(1),IADD,IC(RING),IREM,S(HP));
        P(IC(r.RP+N),ISHL2,G(HP),IST);
        for(let c=0;c<C;c++) P(G(HP),IC(C),IMUL,IC(c),IADD,IC(r.headRing),IADD,ISHL2,LC(r.S_head+c),FST);
        for(let oc=0;oc<la.headOut;oc++){ P(SC(r.S_out+oc, la.headBias?[...LC(r.headBO+oc)]:FC(0)));
          for(let kk=0;kk<la.headK;kk++){ const back=(la.headK-1-kk);
            P(G(HP),IC(back),ISUB,IC(RING),IADD,IC(RING),IREM,S(RI));
            for(let ic=0;ic<C;ic++) P(IC(r.S_out+oc),ISHL2,LC(r.S_out+oc), IC(r.headWO+oc*C*la.headK+ic*la.headK+kk),ISHL2,FL, IC(r.headRing),G(RI),IC(C),IMUL,IC(ic),IADD,IADD,ISHL2,FL,FMUL,FADD,FST); } }
      });
      // io_out[s] = chainOut[0] * headScale
      P(IC(IO_OUT),G(SIDX),IADD,ISHL2, LC(las[las.length-1].S_out),FC(spec.headScale),FMUL, FST);
      P(G(SIDX),IC(1),IADD,TEE(SIDX),G(0),ILT,BRIF(0));
    P([END]);   // close block loop
    P([END]);   // function-body terminator (wasm functions end with 0x0b)

    const locals=vec([[...uleb(16),I32],[...uleb(1),F32]]);
    const types=vec([[96,...vec([I32]),0]]);            // (i32 n) -> void
    const funcs=vec([[0]]);
    const totalBytes=totalF32*4;
    const mems=vec([[0,...uleb(Math.ceil(totalBytes/65536)+2)]]);
    const exports=vec([[...str('m'),2,...uleb(0)],[...str('p'),0,...uleb(0)]]);
    const code=vec([[...uleb(locals.length+body.length),...locals,...body]]);
    const bytes=new Uint8Array([0,97,115,109,1,0,0,0,...sec(1,types),...sec(3,funcs),...sec(5,mems),...sec(7,exports),...sec(10,code)]);
    return { bytes, layout:{ ioIn:IO_IN, ioOut:IO_OUT, writesF, writesI } };
  }

  // ── The worklet processor source. Runs on the audio thread. Receives a PRECOMPILED
  //   WebAssembly.Module + typed-array writes, instantiates (cheap), swaps at a block
  //   boundary with a 128-sample dry->wet crossfade. NEVER compiles. ──
  const PROCESSOR_SRC = `
class NAMProcessor extends AudioWorkletProcessor {
  constructor(){
    super(); this.cur=null; this.next=null; this.bypass=true; this._pinged=false;
    this._slow=0; this._overruns=0; this._fade=0; this._warnedMax=false;
    this._srcQ=null; this._wetQ=[]; this._dryQ=[]; this._qRead=0; this._rateKey=''; this._streamReady=false;
    this.port.onmessage=(e)=>{
      const d=e.data;
      if(d.type==='model'){
        try{
          const inst=new WebAssembly.Instance(d.module);
          const buf=inst.exports.m.buffer;
          const memF=new Float32Array(buf), memI=new Int32Array(buf);
          for(const w of d.layout.writesF) memF.set(w.data, w.off);
          for(const w of d.layout.writesI) memI.set(w.data, w.off);
          this.next={p:inst.exports.p,memF,ioIn:d.layout.ioIn,ioOut:d.layout.ioOut,
            modelRate:Number(d.modelRate)||sampleRate,blockSize:Number(d.blockSize)||480,outHistory:new Array(16).fill(0)};
          this.bypass=false; this._bad=0; this._badPosted=false; this._silentPosted=false; this._wN=0; this._wIn=0; this._wOut=0; this._pinged=false; this._slow=0; this._overruns=0; this._warnedMax=false;
          this._resetQueues(); this.port.postMessage({type:'ready',modelRate:this.next.modelRate,hostRate:sampleRate,blockSize:this.next.blockSize});
        }catch(err){this.port.postMessage({type:'error',msg:err.message});}
      } else if(d.type==='bypass') this.bypass=d.value;
      else if(d.type==='unload'){this.bypass=true;this.cur=null;this.next=null;this._resetQueues();this._pinged=false;this.port.postMessage({type:'unloaded'});}
    };
  }
  _resetQueues(){
    this._srcQ=null; this._wetQ=[]; this._dryQ=[]; this._qRead=0; this._rateKey=''; this._streamReady=false; this._planKey='';
  }
  _sinc(x){ if(Math.abs(x)<1e-8)return 1; const p=Math.PI*x; return Math.sin(p)/p; }
  _makeQueue(m){
    const ratio=sampleRate/m.modelRate;
    const radius=Math.max(8,Math.ceil(8*Math.max(1,ratio)));
    this._srcRadius=radius; this._ratio=ratio; this._sameRate=Math.abs(sampleRate-m.modelRate)<1;
    this._hostRate=sampleRate; this._rateKey=sampleRate+':'+m.modelRate;
    this._srcQ=new Array(radius).fill(0); this._wetQ=[]; this._dryQ=[]; this._qRead=0; this._streamReady=false; this._planKey='';
    this._buildPlans(m,m.blockSize);
  }
  _buildPlans(m,B){
    const ratio=this._ratio,H=Math.max(1,Math.round(B*sampleRate/m.modelRate)),R=this._srcRadius;
    this._hostCount=H; this._planKey=B+':'+H;
    this._downStart=new Int32Array(B); this._downWeights=new Array(B);
    this._upStart=new Int32Array(H); this._upWeights=new Array(H);
    if(this._sameRate)return;
    const cutoff=Math.min(1,1/ratio)*0.94;
    for(let i=0;i<B;i++){
      const pos=R+i*ratio,base=Math.floor(pos),frac=pos-base,start=base-R+1,w=new Float32Array(R*2);let sum=0;
      for(let j=0;j<w.length;j++){const k=-R+1+j,d=frac-k,ad=Math.abs(d);let v=0;if(ad<R)v=cutoff*this._sinc(cutoff*d)*this._sinc(d/R);w[j]=v;sum+=v;}
      if(Math.abs(sum)>1e-9)for(let j=0;j<w.length;j++)w[j]/=sum;
      this._downStart[i]=start;this._downWeights[i]=w;
    }
    const RU=8;
    for(let i=0;i<H;i++){
      const pos=i/ratio-RU,base=Math.floor(pos),frac=pos-base,start=base-RU+1,w=new Float32Array(RU*2);let sum=0;
      for(let j=0;j<w.length;j++){const k=-RU+1+j,d=frac-k,ad=Math.abs(d);let v=0;if(ad<RU)v=this._sinc(d)*this._sinc(d/RU);w[j]=v;sum+=v;}
      if(Math.abs(sum)>1e-9)for(let j=0;j<w.length;j++)w[j]/=sum;
      this._upStart[i]=start;this._upWeights[i]=w;
    }
  }
  _getModelOut(k,cur,m){
    const n=cur.length;
    if(k<0){const j=m.outHistory.length+k;return j>=0?m.outHistory[j]:0;}
    if(k>=n)return cur[n-1]||0;
    return cur[k];
  }
  _lanczosInput(q,pos,radius,cutoff){
    const lo=Math.max(0,Math.floor(pos-radius)+1), hi=Math.min(q.length-1,Math.floor(pos+radius));
    let sum=0,ws=0;
    for(let k=lo;k<=hi;k++){
      const d=pos-k, ad=Math.abs(d); if(ad>=radius)continue;
      const w=cutoff*this._sinc(cutoff*d)*this._sinc(d/radius);
      sum+=q[k]*w; ws+=w;
    }
    return Math.abs(ws)>1e-9?sum/ws:0;
  }
  _lanczosOutput(pos,cur,m){
    const radius=8, lo=Math.floor(pos-radius)+1, hi=Math.floor(pos+radius);
    let sum=0,ws=0;
    for(let k=lo;k<=hi;k++){
      const d=pos-k, ad=Math.abs(d); if(ad>=radius)continue;
      const w=this._sinc(d)*this._sinc(d/radius);
      sum+=this._getModelOut(k,cur,m)*w; ws+=w;
    }
    return Math.abs(ws)>1e-9?sum/ws:0;
  }
  _enqueueBlock(m,sourceStart,hostCount,modelOut,wet){
    const q=this._srcQ, radius=this._srcRadius, ratio=this._ratio, B=m.blockSize;
    const dry=new Float32Array(hostCount);
    // Align the bypass crossfade with the resampler's eight-model-sample causal delay.
    const delay= this._sameRate ? 0 : 8*ratio;
    for(let i=0;i<hostCount;i++){
      const p=radius+i-delay, a=Math.floor(p), f=p-a;
      const x0=q[Math.max(0,Math.min(q.length-1,a))]||0;
      const x1=q[Math.max(0,Math.min(q.length-1,a+1))]||0;
      dry[i]=x0+(x1-x0)*f;
    }
    for(let i=0;i<hostCount;i++){
      let y;
      if(this._sameRate)y=modelOut[i]||0;
      else {const start=this._upStart[i],w=this._upWeights[i];let v=0;for(let j=0;j<w.length;j++)v+=this._getModelOut(start+j,modelOut,m)*w[j];y=v;}
      wet[i]=y;
    }
    for(let i=0;i<hostCount;i++){this._wetQ.push(wet[i]);this._dryQ.push(dry[i]);}
    if(this._wetQ.length-this._qRead>=2*hostCount)this._streamReady=true;
  }
  process(inputs,outputs){
    const inp=inputs[0],out=outputs[0];
    if(!inp||!inp.length)return true;
    const inCh=inp[0],L=inCh.length,outL=out[0],outR=out[1]||out[0];
    if(this.next){this.cur=this.next;this.next=null;this._resetQueues();this._fade=128;}
    const m=this.cur;
    if(this.bypass||!m){for(let i=0;i<L;i++){outL[i]=inCh[i];if(out[1])outR[i]=inCh[i];}return true;}
    if(!this._pinged){this._pinged=true;this.port.postMessage({type:'processing',modelRate:m.modelRate,hostRate:sampleRate});}
    if(!this._srcQ||this._rateKey!==sampleRate+':'+m.modelRate)this._makeQueue(m);
    for(let i=0;i<L;i++)this._srcQ.push(inCh[i]);
    let workMs=0;
    // At most one NAM block per render quantum: never burst four blocks on the audio thread.
    const B=m.blockSize, ratio=this._ratio, radius=this._srcRadius;
    const H=Math.max(1,Math.round(B*sampleRate/m.modelRate));
    const planKey=B+':'+H;if(this._planKey!==planKey)this._buildPlans(m,B);
    if(this._srcQ.length>=radius+H+radius){
      const t0=performance.now?performance.now():0;
      const q=this._srcQ, modelIn=new Float32Array(B), modelOut=new Float32Array(B);
      if(this._sameRate){for(let i=0;i<B;i++)modelIn[i]=q[radius+i]||0;}
      else {
        for(let i=0;i<B;i++){const start=this._downStart[i],w=this._downWeights[i];let v=0;for(let j=0;j<w.length;j++)v+=(q[start+j]||0)*w[j];modelIn[i]=v;}
      }
      m.memF.set(modelIn,m.ioIn);m.p(B);modelOut.set(m.memF.subarray(m.ioOut,m.ioOut+B));
      this._enqueueBlock(m,0,H,modelOut,new Float32Array(H));
      m.outHistory=m.outHistory.concat(Array.from(modelOut)).slice(-16);
      // Slide by H while retaining the most recent R samples as FIR history.
      q.splice(0,H);
      if(t0){const dt=performance.now()-t0;workMs=dt;const budgetMs=(B/m.modelRate)*1000;
        // Increase only when the block is still inside its budget but losing headroom.
        if(dt>budgetMs*0.62&&dt<budgetMs*0.9)this._slow++;else this._slow=0;
        if(this._slow>=2){
          const steps=[32,48,64],at=steps.indexOf(m.blockSize);
          if(at>=0&&at<steps.length-1){m.blockSize=steps[at+1];this._slow=0;this._planKey='';this.port.postMessage({type:'buffer',blockSize:m.blockSize,modelRate:m.modelRate,reason:'processing headroom'});}
          else if(at===steps.length-1&&!this._warnedMax){this._warnedMax=true;this.port.postMessage({type:'overrun',blockSize:m.blockSize,modelRate:m.modelRate,reason:'maximum quantum-aligned block reached'});}
        }
      }
    }
    for(let i=0;i<L;i++){
      let y=0,dry=0;
      if(this._streamReady&&this._qRead<this._wetQ.length){y=this._wetQ[this._qRead]||0;dry=this._dryQ[this._qRead]||0;this._qRead++;}
      if(this._fade>0){const g=(128-this._fade)/128;y=dry*(1-g)+y*g;this._fade--;}
      if(!(y>-16&&y<16)){y=0;this._bad=(this._bad|0)+1;}
      outL[i]=y;if(out[1])outR[i]=y;
    }
    {let ip=0,op=0;for(let i=0;i<L;i++){const a=inCh[i]<0?-inCh[i]:inCh[i];if(a>ip)ip=a;const b=outL[i]<0?-outL[i]:outL[i];if(b>op)op=b;}
     this._wIn=Math.max(this._wIn||0,ip);this._wOut=Math.max(this._wOut||0,op);
     if(this._bad&&!this._badPosted){this._badPosted=true;this.port.postMessage({type:'error',msg:'model output is NaN/Inf - muted (host '+sampleRate+' Hz / model '+m.modelRate+' Hz)'});}
     if((this._wN=(this._wN|0)+1)>=Math.ceil(sampleRate/L)){
       this.port.postMessage({type:'slot-meter',inputPeak:this._wIn,outputPeak:this._wOut,modelRate:m.modelRate,hostRate:sampleRate,blockSize:m.blockSize,streamReady:this._streamReady});
       if(this._wIn>0.002&&this._wOut<1e-7&&this._streamReady&&!this._silentPosted){this._silentPosted=true;this.port.postMessage({type:'error',msg:'model output silent while input present (host '+sampleRate+' Hz / model '+m.modelRate+' Hz)'});}
       this._wN=0;this._wIn=0;this._wOut=0;}}
    if(this._qRead>4096){this._wetQ=this._wetQ.slice(this._qRead);this._dryQ=this._dryQ.slice(this._qRead);this._qRead=0;}
    if(workMs>0){const callbackMs=(L/sampleRate)*1000;if(workMs>callbackMs*0.8){this._overruns++;if(this._overruns>=2)this.port.postMessage({type:'deadline-risk',workMs:+workMs.toFixed(2),callbackMs:+callbackMs.toFixed(2),blockSize:m.blockSize});}else this._overruns=Math.max(0,this._overruns-1);}
    return true;
  }
}
class KSProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.voices=new Map();
    this.port.onmessage=(e)=>{
      const d=e.data;
      if(d.type==='pluck'){ this.voices.set(d.id, this.mkVoice(d.freq, d.vel, d.voice, d.pickup)); }
      else if(d.type==='release'){ const v=this.voices.get(d.id); if(v) v.releasing=true; }
      else if(d.type==='retune'){ const v=this.voices.get(d.id); if(v) this.retune(v, d.freq); }
      else if(d.type==='kill'){ this.voices.delete(d.id); }
    };
  }
  mkVoice(freq, vel, voice, pickup){
    const L=Math.max(2, Math.round(sampleRate/freq));
    const buf=new Float32Array(L);
    const strat = voice==='strat';
    // v614: the 5-way pickup selector, finally WIRED (the UI sent d.pickup; mkVoice dropped it).
    //   A magnetic pickup reads the string at a point -> comb filter nulling harmonics with a node
    //   there. Fractions of scale length from the bridge (25.5" Strat): bridge .068, mid .13,
    //   neck .21. Positions 2/4 blend two pickups - the phase-cancelled Strat 'quack'.
    const _PKF = strat ? ({1:[0.21], 2:[0.21,0.13], 3:[0.13], 4:[0.13,0.068], 5:[0.068]}[pickup||5]||[0.068]) : null;
    // Strat single-coil: brighter pick attack + more high harmonics in excitation.
    const bright = strat ? (0.55+0.4*vel) : (0.25+0.55*vel);
    let lp=0;
    for(let i=0;i<L;i++){ const w=Math.random()*2-1; lp+=bright*(w-lp); buf[i]=lp; }
    // Strat: slightly less damping (brighter sustain) + a touch more feedback (Fender ring).
    return { buf, L, ptr:0, prev:0,
             R: strat ? Math.min(0.9994, Math.max(0.9955+(110/freq)*0.004, Math.exp(-6.908/(12*freq)))) : Math.min(0.9985, 0.993+(110/freq)*0.004),   // v628: ELEC sustains ~flat under the 5.5s hold (no choke), like STRAT
             damp: strat ? 0.85 : 0.5,      // v628: ELEC brighter/longer tail to match STRAT (was 0.62)
             pkF:_PKF, pkD:_PKF?_PKF.map(f=>Math.max(1,Math.round(L*f))):null,   // v614: pickup tap(s)
             ex1:0,ex2:0,ey1:0,ey2:0, fx1:0,fx2:0,fy1:0,fy2:0,   // v629: ELEC EQ (STRAT shape) biquad state
             gain:Math.min(1, 0.5+0.5*vel), releasing:false, rel:1.0 };
  }
  retune(v, freq){
    const L=Math.max(2, Math.round(sampleRate/freq));
    if(L===v.L) return;
    const nb=new Float32Array(L);
    for(let i=0;i<L;i++) nb[i]=v.buf[Math.floor(i*v.L/L)%v.L];  // resample string state
    v.buf=nb; v.L=L; v.ptr=v.ptr%L;
    if(v.pkF) v.pkD=v.pkF.map(f=>Math.max(1,Math.round(L*f)));   // v614: pickup taps track the new pitch
  }
  process(inputs, outputs){
    const out=outputs[0]; const chL=out[0], chR=out[1]||out[0];
    const N=chL.length;
    for(let n=0;n<N;n++){ chL[n]=0; }
    if(this.voices.size>0 && !this._pinged){ this._pinged=true; this.port.postMessage({type:'active'}); }
    // v629: ELEC borrows STRAT's EQ shape - highpass (bright, not bassy) + 1.8kHz presence.
    const _mkHP=(f0,Q)=>{ const w=2*Math.PI*f0/sampleRate, cs=Math.cos(w), al=Math.sin(w)/(2*Q), a0=1+al;
      return [((1+cs)/2)/a0, (-(1+cs))/a0, ((1+cs)/2)/a0, (-2*cs)/a0, (1-al)/a0]; };
    const _mkPk=(f0,Q,g)=>{ const A=Math.pow(10,g/40), w=2*Math.PI*f0/sampleRate, cs=Math.cos(w), al=Math.sin(w)/(2*Q), a0=1+al/A;
      return [(1+al*A)/a0,(-2*cs)/a0,(1-al*A)/a0,(-2*cs)/a0,(1-al/A)/a0]; };
    const _EC1=_mkHP(130, 0.7);            // STRAT highpass: cut mud below 130Hz
    const _EC2=_mkPk(1800, 1.4, 4.0);      // STRAT presence: +4dB @ 1.8kHz (cut-through)
    for(const [id,v] of this.voices){
      const dc=v.damp||0.5;
      for(let n=0;n<N;n++){
        const cur=v.buf[v.ptr];
        let y=(dc*cur + (1-dc)*v.prev)*v.R;
        v.prev=cur;
        v.buf[v.ptr]=y;
        if(v.pkD){   // v614: pickup-position comb - y minus the string d samples back, per pickup
          let po=0; for(let t=0;t<v.pkD.length;t++){ const d0=v.pkD[t]%v.L||1; po += y - v.buf[(v.ptr-d0+v.L)%v.L]; }
          y = (po/v.pkD.length)*0.55;   // v614: comb can constructively double - keep headroom
        }
        v.ptr=(v.ptr+1)%v.L;
        if(v.pkF){   // v629: STRAT EQ shape on the single-coil - HP@130 then presence@1800, in series
          let _e=y; { const x=_e; _e=_EC1[0]*x+_EC1[1]*v.ex1+_EC1[2]*v.ex2-_EC1[3]*v.ey1-_EC1[4]*v.ey2; v.ex2=v.ex1; v.ex1=x; v.ey2=v.ey1; v.ey1=_e; }
          { const x=_e; _e=_EC2[0]*x+_EC2[1]*v.fx1+_EC2[2]*v.fx2-_EC2[3]*v.fy1-_EC2[4]*v.fy2; v.fx2=v.fx1; v.fx1=x; v.fy2=v.fy1; v.fy1=_e; }
          const _d=Math.max(-1,Math.min(1,_e*4.5));   // v631: more drive -> more of the signal clips (was 2.4)
          y = Math.tanh(8*_d)*0.5;                     // v631: harder/brighter clip, k=8 (was 6) = grittier breakup
        }
        if(v.releasing){ v.rel*=0.9992; }
        chL[n]+=y*v.gain*v.rel;
      }
      if(v.releasing && v.rel<0.0008) this.voices.delete(id);
    }
    if(out[1]) for(let n=0;n<N;n++) chR[n]=chL[n];
    return true;
  }
}
registerProcessor('ks-processor', KSProcessor);
registerProcessor('nam-processor',NAMProcessor);
`;

  // flatten a NAM json (or SlimmableContainer tier) into the emitter's spec.
  function flattenModel(json,tier){
    if(!json || typeof json!=='object') throw new Error('realtime NAM: invalid model JSON');
    let arch=json.architecture, cfg=json.config, sr=json.sample_rate, weights;
    if(arch==='SlimmableContainer'){
      const subs=cfg&&cfg.submodels;
      if(!Array.isArray(subs)||!subs.length) throw new Error('realtime NAM: SlimmableContainer has no submodels');
      // A2 Slimmable files contain Lite and Full tiers. Unless explicitly requested,
      // select the smallest tier (A2 Lite) instead of the previous Full-first default.
      const pick=tier!=null
        ? subs.find(x=>Number(x.max_value)===Number(tier))
        : subs.reduce((a,b)=>Number(b.max_value)<Number(a.max_value)?b:a);
      if(!pick||!pick.model) throw new Error('realtime NAM: requested SlimmableContainer tier is unavailable');
      arch=pick.model.architecture; cfg=pick.model.config; sr=pick.model.sample_rate||json.sample_rate||sr; weights=pick.model.weights;
    } else weights=json.weights;
    if(arch!=='WaveNet') throw new Error('realtime NAM: unsupported architecture '+String(arch));
    if(!cfg||!Array.isArray(cfg.layers)||!cfg.layers.length) throw new Error('realtime NAM: WaveNet config has no layers');
    if(cfg.condition_dsp) throw new Error('realtime NAM: models with condition_dsp are not supported by the realtime path');
    if(cfg.head!=null) throw new Error('realtime NAM: top-level WaveNet head is not supported by the realtime path');
    if(!Array.isArray(weights) && !ArrayBuffer.isView(weights)) throw new Error('realtime NAM: model weights are missing');
    let wp=0;
    const nextN=(n)=>{
      if(!Number.isInteger(n)||n<0) throw new Error('realtime NAM: invalid computed weight count');
      const part=weights.slice(wp,wp+n);
      if(part.length!==n) throw new Error('realtime NAM: truncated weights (expected '+n+' values at offset '+wp+')');
      wp+=n; return part;
    };
    function activationSlope(a,layerIndex){
      if(a==null) return 0.01; // legacy NAM default is LeakyReLU(0.01)
      if(typeof a==='string'){
        const t=a.toLowerCase().replace(/[ _-]/g,'');
        if(t==='leakyrelu'||t==='lrelu') return 0.01;
        if(t==='relu') return 0;
        throw new Error('realtime NAM: unsupported activation '+a+' (only LeakyReLU/ReLU are supported)');
      }
      if(typeof a!=='object') throw new Error('realtime NAM: invalid activation descriptor');
      const type=String(a.type||a.name||'').toLowerCase().replace(/[ _-]/g,'');
      if(type && !['leakyrelu','lrelu','relu','prelu'].includes(type))
        throw new Error('realtime NAM: unsupported activation '+(a.type||a.name)+' (supported: LeakyReLU, ReLU, uniform PReLU)');
      if(type==='relu') return 0;
      if(a.negative_slope!=null){
        const slope=Number(a.negative_slope);
        if(!Number.isFinite(slope)||slope<0)throw new Error('realtime NAM: invalid activation negative_slope');
        return slope;
      }
      // A2 PReLU can expose per-channel slopes. This emitter has one slope per layer,
      // so permit it only when every channel uses the same finite, non-negative value.
      if(Array.isArray(a.negative_slopes)&&a.negative_slopes.length){
        const first=Number(a.negative_slopes[0]);
        if(!Number.isFinite(first)||first<0||!a.negative_slopes.every(v=>Number(v)===first))
          throw new Error('realtime NAM: channel-wise PReLU slopes are not supported');
        return first;
      }
      if(type==='prelu')throw new Error('realtime NAM: PReLU is missing its negative slope');
      return 0.01;
    }
    const layerArrays=cfg.layers.map((raw,idx)=>{
      const lc=Object.assign({},raw);
      const C=Number(lc.channels), N=Array.isArray(lc.dilations)?lc.dilations.length:0;
      if(!Number.isInteger(C)||C<1||!N) throw new Error('realtime NAM: invalid layer-array dimensions at index '+idx);
      const gating=lc.gating_mode;
      const gated=lc.gated===true || (Array.isArray(gating)?gating.some(g=>g&&String(g).toLowerCase()!=='none'):!!(gating&&String(gating).toLowerCase()!=='none'));
      if(gated) throw new Error('realtime NAM: gated/blended activation is not supported by the realtime path');
      if(lc.bottleneck!==undefined && lc.bottleneck!==C) throw new Error('realtime NAM: bottleneck is not supported by the realtime path');
      for(const k of ['conv_pre_film','conv_post_film','input_mixin_pre_film','input_mixin_post_film','activation_pre_film','activation_post_film','layer1x1_post_film','head1x1_post_film','1x1_post_film'])
        if(lc[k]&&lc[k].active!==false) throw new Error('realtime NAM: FiLM feature '+k+' is not supported by the realtime path');
      const h1=lc.head1x1||lc.head_1x1;
      if(h1&&h1.active) throw new Error('realtime NAM: active per-layer head1x1 is not supported by the realtime path');
      const layer1=lc.layer1x1||lc.layer_1x1||lc['1x1'];
      if(layer1&&layer1.active===false) throw new Error('realtime NAM: disabled layer1x1 is not supported by the realtime path');
      if((lc.groups_input!=null&&Number(lc.groups_input)!==1) || (lc.groups_input_mixin!=null&&Number(lc.groups_input_mixin)!==1) || (lc.groups_1x1!=null&&Number(lc.groups_1x1)!==1) || (lc['1x1_groups']!=null&&Number(lc['1x1_groups'])!==1) || (layer1&&layer1.groups!=null&&Number(layer1.groups)!==1))
        throw new Error('realtime NAM: grouped convolutions are not supported by the realtime path');
      // A2 WaveNet config uses scalar kernel_size + head_size/head_bias. Older A1 files
      // use kernel_sizes[] + a per-array head descriptor. Normalize the simple A2 form
      // into the same internal representation; their weight order is identical when
      // there is no active head1x1, bottleneck, gating, or FiLM.
      if(!Array.isArray(lc.kernel_sizes) && Number.isInteger(lc.kernel_size))
        lc.kernel_sizes=Array(N).fill(lc.kernel_size);
      if(!lc.head && Number.isInteger(lc.head_size))
        lc.head={out_channels:lc.head_size,kernel_size:1,bias:!!lc.head_bias};
      if(!Array.isArray(lc.kernel_sizes)||lc.kernel_sizes.length!==N||!lc.kernel_sizes.every(k=>Number.isInteger(k)&&k>=1))
        throw new Error('realtime NAM: unsupported kernel configuration in layer array '+idx);
      const head=lc.head;
      if(!head||!Number.isInteger(head.out_channels)||head.out_channels<1||!Number.isInteger(head.kernel_size)||head.kernel_size<1)
        throw new Error('realtime NAM: unsupported head configuration in layer array '+idx);
      const inputSize=Number(lc.input_size), condSize=Number(lc.condition_size);
      if(!Number.isInteger(inputSize)||inputSize<1||!Number.isInteger(condSize)||condSize<1)
        throw new Error('realtime NAM: invalid input/condition size in layer array '+idx);
      const act=lc.activation;
      const slopes=Array.from({length:N},(_,i)=>activationSlope(Array.isArray(act)?act[i]:act,i));
      let count=C*inputSize;
      for(let i=0;i<N;i++) count+=C*C*lc.kernel_sizes[i]+C+C*condSize+C*C+C;
      count+=head.out_channels*C*head.kernel_size+(head.bias?head.out_channels:0);
      const block=Float32Array.from(nextN(count));
      return {inputSize,condSize,channels:C,dilations:lc.dilations.slice(),kernelSizes:lc.kernel_sizes.slice(),slopes,headOut:head.out_channels,headK:head.kernel_size,headBias:!!head.bias,weights:block};
    });
    const headScale=Number(weights[wp]);
    if(!Number.isFinite(headScale)) throw new Error('realtime NAM: missing or invalid head_scale');
    if(wp+1!==weights.length) throw new Error('realtime NAM: weight count mismatch (consumed '+(wp+1)+' of '+weights.length+')');
    const maxKernel=Math.max.apply(null,layerArrays.map(l=>Math.max(l.headK,Math.max.apply(null,l.kernelSizes))));
    return {layerArrays,headScale,maxKernel,sampleRate:sr};
  }
  return { route, setModel, setBypass, setInputGain, setIR, setParam, setFxEnabled,
           get pedalOn(){return _pedalOn;}, get ampOn(){return _ampOn;}, get irOn(){return _irOn;},
           get active(){return active;}, get ready(){return ready;}, flattenModel, emitChain };
})();
window.NAMRealtime=NAMRealtime;


// ── minimal ZIP reader: find first *.nam entry, inflate via native DecompressionStream ──
async function extractNamFromZip(file){
  const buf=await file.arrayBuffer(), dv=new DataView(buf), u8=new Uint8Array(buf);
  let eocd=-1;
  for(let i=buf.byteLength-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('not a valid zip');
  const entryCount=dv.getUint16(eocd+10,true), cdOffset=dv.getUint32(eocd+16,true);
  let p=cdOffset;
  for(let e=0;e<entryCount;e++){
    if(dv.getUint32(p,true)!==0x02014b50) throw new Error('bad zip central directory');
    const method=dv.getUint16(p+10,true), compSize=dv.getUint32(p+20,true),
          nameLen=dv.getUint16(p+28,true), extraLen=dv.getUint16(p+30,true), commentLen=dv.getUint16(p+32,true),
          lhOffset=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
    if(/\.nam$/i.test(name)){
      const lhNameLen=dv.getUint16(lhOffset+26,true), lhExtraLen=dv.getUint16(lhOffset+28,true);
      const dataStart=lhOffset+30+lhNameLen+lhExtraLen;
      const compressed=u8.subarray(dataStart,dataStart+compSize);
      let out;
      if(method===0){ out=compressed; }
      else if(method===8){
        if(!window.DecompressionStream) throw new Error('browser lacks DecompressionStream — cannot unzip');
        const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out=new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('unsupported zip compression method '+method);
      return new TextDecoder().decode(out);
    }
    p=p+46+nameLen+extraLen+commentLen;
  }
  throw new Error('no .nam file found inside zip');
}
// ── TONE3000 API client — OAuth PKCE + search + download, zero-dependency ────
const T3K=(function(){
  const BASE='https://www.tone3000.com/api/v1';
  const SS='t3k_';
  function b64url(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  async function sha256(s){ return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); }
  function rand(n){ const a=new Uint8Array(n); crypto.getRandomValues(a); return b64url(a.buffer); }
  function configured(){ return !!(window.T3K_PUBLISHABLE_KEY&&window.T3K_REDIRECT_URI); }
  function connected(){ return !!localStorage.getItem(SS+'access'); }

  function storeTokens(t){
    localStorage.setItem(SS+'access',t.access_token);
    if(t.refresh_token) localStorage.setItem(SS+'refresh',t.refresh_token);
    localStorage.setItem(SS+'expires',String(Date.now()+(t.expires_in||3600)*1000));
  }
  function clearTokens(){ localStorage.removeItem(SS+'access'); localStorage.removeItem(SS+'refresh'); localStorage.removeItem(SS+'expires'); }

  async function refresh(){
    const rt=localStorage.getItem(SS+'refresh'); if(!rt) throw new Error('no refresh token');
    const r=await fetch(BASE+'/oauth/token',{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({ grant_type:'refresh_token', refresh_token:rt, client_id:window.T3K_PUBLISHABLE_KEY }) });
    if(!r.ok){ clearTokens(); throw new Error('refresh failed '+r.status); }
    const t=await r.json(); storeTokens(t); return t.access_token;
  }
  async function token(){
    let a=localStorage.getItem(SS+'access'); const exp=parseInt(localStorage.getItem(SS+'expires')||'0');
    if(!a) throw new Error('not connected');
    if(Date.now()>exp-30000) a=await refresh();
    return a;
  }
  async function authed(path){
    const t=await token();
    const r=await fetch(BASE+path,{ headers:{ Authorization:'Bearer '+t } });
    if(r.status===401){ const t2=await refresh(); const r2=await fetch(BASE+path,{ headers:{ Authorization:'Bearer '+t2 } }); if(!r2.ok) throw new Error('request failed '+r2.status); return r2.json(); }
    if(!r.ok) throw new Error('request failed '+r.status);
    return r.json();
  }

  // Start OAuth. prompt omitted = standard connect (no tone browse). Returns via redirect.
  async function connect(prompt, extra){
    if(!configured()) throw new Error('TONE3000 not configured');
    if(!window.T3K_REDIRECT_URI) throw new Error('OAuth needs https hosting (GitHub Pages) — no redirect URI under file:// or content://');
    const verifier=rand(48); const challenge=b64url(await sha256(verifier)); const state=rand(16);
    sessionStorage.setItem(SS+'verifier',verifier); sessionStorage.setItem(SS+'state',state);
    const p=new URLSearchParams({ client_id:window.T3K_PUBLISHABLE_KEY, redirect_uri:window.T3K_REDIRECT_URI,
      response_type:'code', code_challenge:challenge, code_challenge_method:'S256', state });
    if(prompt) p.set('prompt',prompt);
    if(extra) for(const k in extra) p.set(k,extra[k]);
    location.href=BASE+'/oauth/authorize?'+p.toString();
  }

  // Complete OAuth on redirect return. Returns {toneId|null} or null if no callback.
  async function handleCallback(){
    const q=new URLSearchParams(location.search);
    const code=q.get('code'); if(!code) return null;
    const state=q.get('state'), toneId=q.get('tone_id');
    if(state!==sessionStorage.getItem(SS+'state')) throw new Error('state mismatch');
    const r=await fetch(BASE+'/oauth/token',{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({ grant_type:'authorization_code', code, code_verifier:sessionStorage.getItem(SS+'verifier'),
        redirect_uri:window.T3K_REDIRECT_URI, client_id:window.T3K_PUBLISHABLE_KEY }) });
    if(!r.ok) throw new Error('token exchange failed '+r.status);
    storeTokens(await r.json());
    history.replaceState(null,'',window.T3K_REDIRECT_URI);
    return { toneId };
  }

  function search(opts){ // {query,gears,format,architecture,sort,page,page_size}
    const p=new URLSearchParams({ architecture:'2', page:String(opts.page||1), page_size:String(opts.page_size||20) });
    if(opts.query) p.set('query',opts.query);
    if(opts.gears) p.set('gears',opts.gears);
    if(opts.format) p.set('format',opts.format);
    if(opts.sort) p.set('sort',opts.sort);
    return authed('/tones/search?'+p.toString());
  }
  function favorited(page){ return authed('/tones/favorited?page='+(page||1)+'&page_size=20'); }
  async function getTone(toneId){
    if(toneId==null||String(toneId).trim()==='') throw new Error('Tone ID is required');
    return authed('/tones/'+encodeURIComponent(toneId)+'?architecture=2');
  }
  async function listModels(toneId){
    // Fetch all model pages; tones may have multiple NAM captures/variants.
    let page=1, all=[], totalPages=1;
    do {
      const res=await authed('/models?tone_id='+encodeURIComponent(toneId)+'&architecture=2&page_size=100&page='+page);
      const batch=Array.isArray(res)?res:(Array.isArray(res.data)?res.data:(Array.isArray(res.models)?res.models:[]));
      all=all.concat(batch);
      totalPages=Math.max(1,Number(res.total_pages||res.pagination&&res.pagination.total_pages)||1);
      page++;
    } while(page<=totalPages && page<=20);
    return {data:all};
  }
  async function resolveModel(toneId, selected){
    const id=selected&&typeof selected==='object'?selected.id:selected;
    if(id==null) throw new Error('Selected TONE3000 variant has no model ID');
    const result=await listModels(toneId);
    const variants=Array.isArray(result.data)?result.data:[];
    const fresh=variants.find(m=>String(m.id)===String(id));
    const model=fresh||(variants.length===0&&selected&&typeof selected==='object'?selected:null);
    if(!model||!model.model_url) throw new Error('TONE3000 returned no download URL for model '+id);
    return {model,variants};
  }
  async function downloadModel(modelUrl){
    const t=await token();
    const r=await fetch(modelUrl,{ headers:{ Authorization:'Bearer '+t } });
    if(!r.ok) throw new Error('download failed '+r.status);
    return r.blob();
  }

  return { configured, connected, connect, handleCallback, clearTokens, search, favorited, getTone, listModels, resolveModel, downloadModel };
})();
window.T3K=T3K;

// ── RIG module — pedal/amp/cab slots, file or TONE3000 load, dropdown UI ─────────
(function(){
  const btnRig=document.getElementById('btnRig'), panel=document.getElementById('rigPanel');
  const fileNam=document.getElementById('rigFileNam'), fileIr=document.getElementById('rigFileIr');
  const rigStat=document.getElementById('rigStat');
  // per-slot state
  const S={ pedal:{loaded:false,json:null,toneId:null,modelId:null,modelName:'',toneTitle:'',variants:[]}, amp:{loaded:false,json:null,toneId:null,modelId:null,modelName:'',toneTitle:'',variants:[]}, cab:{loaded:false,toneId:null,modelId:null,modelName:'',toneTitle:'',variants:[]} };
  // Inline capture selector: remains attached to the loaded tone and only changes its model/capture.
  function ensureVariantSelect(slot){
    const el=slotEl(slot); if(!el) return null;
    let sel=el.querySelector('.rigVariant'); if(sel) return sel;
    sel=document.createElement('select'); sel.className='rigVariant'; sel.setAttribute('aria-label',slot+' NAM variant');
    sel.style.cssText='display:none;max-width:100%;min-width:115px;background:#101827;color:#e2e8f0;border:1px solid #38bdf8;border-radius:6px;padding:5px;font-size:0.78em;';
    const name=el.querySelector('.rigName'); if(name&&name.parentNode) name.insertAdjacentElement('afterend',sel); else el.appendChild(sel);
    sel.addEventListener('change',async()=>{
      const st=S[slot], idx=Number(sel.value), model=st&&st.variants&&st.variants[idx];
      if(!st||!model||String(model.id)===String(st.modelId)) return;
      sel.disabled=true;
      try{ await loadToneModel({id:st.toneId,title:st.toneTitle||st.toneName||st.modelName,format:slot==='cab'?'ir':'nam'},model,{keepModal:false,variantSwitch:true,slotOverride:slot}); }
      catch(err){ console.warn('[T3K variant switch]',err); }
      finally{ sel.disabled=false; refreshVariantSelect(slot); if(st.modelId==null) sel.value=''; }
    });
    return sel;
  }
  function refreshVariantSelect(slot){
    const st=S[slot], sel=ensureVariantSelect(slot); if(!st||!sel) return;
    const list=Array.isArray(st.variants)?st.variants:[];
    if(!st.loaded||!st.toneId||list.length<2){ sel.style.display='none'; sel.innerHTML=''; return; }
    sel.innerHTML=list.map((m,i)=>'<option value="'+i+'">'+escapeT3k(m.name||('Variant '+(i+1)))+'</option>').join('');
    const idx=list.findIndex(m=>String(m.id)===String(st.modelId));
    sel.value=idx>=0?String(idx):'0'; sel.style.display='inline-block';
  }
  async function hydrateVariants(slot){
    const st=S[slot]; if(!st||!st.toneId) return;
    try{ const res=await T3K.listModels(st.toneId); st.variants=(res&&res.data)||res||[]; refreshVariantSelect(slot); }
    catch(e){ console.warn('[T3K] variant list refresh failed',e); refreshVariantSelect(slot); }
  }
  let fileTargetSlot=null, t3kTargetSlot=null;
  function setStat(t){ if(rigStat) rigStat.textContent=t||''; }
  function slotEl(slot){ return panel && panel.querySelector('.rigSlot[data-slot="'+slot+'"]'); }
  function paint(){
    if(!panel) return;
    ['pedal','amp','cab'].forEach(slot=>{
      const el=slotEl(slot); if(!el) return;
      const on = slot==='pedal'?NAMRealtime.pedalOn : slot==='amp'?NAMRealtime.ampOn : NAMRealtime.irOn;
      const tog=el.querySelector('.rigToggle');
      if(tog){ tog.textContent=on?'ON':'OFF';
        tog.style.color=on?'#6ee7b7':'#889'; tog.style.borderColor=on?'#10b981':'#444'; }
      const clr=el.querySelector('.rigClear');
      if(clr) clr.style.display=S[slot].loaded?'inline':'none';
    });
  }
  function toggleBtn(){ if(btnRig) btnRig.classList.toggle('active', !!(NAMRealtime.pedalOn||NAMRealtime.ampOn||NAMRealtime.irOn)); }
  function reroute(){ return NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, NAMRealtime.irOn).then(()=>{paint();toggleBtn();}); }

  // v861-lite20: shell owns open/close. Panel handlers are idempotent via _uiBound.
  function onPanelClick(e){
    if(!panel) return;
    const btn=e.target.closest && e.target.closest('button');
    if(!btn || !panel.contains(btn)) return;
    // SNAP handled by dedicated listeners
    if(btn.classList.contains('rigSnap') || btn.classList.contains('rigSnapSave')) return;
    const slotDiv=btn.closest('.rigSlot');
    if(slotDiv){
      const slot=slotDiv.getAttribute('data-slot');
      if(btn.classList.contains('rigToggle')){
        // Optimistic flip so OFF never looks stuck; route commits state first, then wires.
        try{ window.ensureAudio&&window.ensureAudio(); }catch(err){}
        var wantPedal=NAMRealtime.pedalOn, wantAmp=NAMRealtime.ampOn, wantIr=NAMRealtime.irOn;
        if(slot==='pedal') wantPedal=!wantPedal;
        else if(slot==='amp') wantAmp=!wantAmp;
        else wantIr=!wantIr;
        // Immediate paint from desired flags (route sets them at entry)
        NAMRealtime.route(wantPedal, wantAmp, wantIr).then(function(){
          paint(); toggleBtn();
        }).catch(function(err){
          console.warn('[rig] toggle route failed', err);
          paint(); toggleBtn();
          setStat('toggle failed: '+(err&&err.message||err));
        });
      } else if(btn.classList.contains('rigFile')){
        fileTargetSlot=slot;
        try{
          if(slot==='cab'){ if(fileIr){ fileIr.value=''; fileIr.click(); } }
          else { if(fileNam){ fileNam.value=''; fileNam.click(); } }
        }catch(err){ setStat('file picker failed'); }
      } else if(btn.classList.contains('rigT3k')){
        openT3k(slot);
      } else if(btn.classList.contains('rigClear')){
        clearSlot(slot);
      } else if(btn.classList.contains('rigFx')){
        const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]');
        if(fp) fp.style.display = fp.style.display==='block'?'none':'block';
      }
    }
  }
  function bindPanelUI(){
    if(!panel){ console.warn('[rig] rigPanel missing'); return; }
    if(!_uiBound){
      panel.addEventListener('click', onPanelClick);
      _uiBound=true;
    }
    paint(); toggleBtn();
  }
  // Shell calls this after load / open
  window.__rigBindUI = bindPanelUI;
  bindPanelUI();
  ['pedal','amp','cab'].forEach(ensureVariantSelect);

  // Build GATEWAY-style param panel for each slot (Input/Threshold/Bass/Middle/Treble/Output + gate/EQ)
  function buildFxPanel(slot){
    const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]'); if(!fp||fp._built) return;
    fp._built=true;
    fp.style.cssText='display:none;background:#1e1033;border:1px solid #7c3aed;border-radius:5px;padding:8px;margin:2px 0 4px 50px;';
    // DSP controls are intentionally independent of the Tone3000 model and quality tier.
    const knobs=[
      ['input','Input',-20,20,0,' dB'], ['drive','Drive',0,10,0,''],
      ['lowCut','Low Cut',20,500,35,' Hz'], ['bassFreq','Bass Freq',40,500,120,' Hz'],
      ['bass','Bass Gain',0,10,5,''], ['midFreq','Mid Freq',100,8000,800,' Hz'],
      ['midQ','Mid Q',0.3,5,0.7,''], ['middle','Mid Gain',0,10,5,''],
      ['trebleFreq','Treble Freq',1000,12000,3000,' Hz'], ['treble','Treble Gain',0,10,5,''],
      ['highCut','High Cut',1000,20000,18000,' Hz'], ['reverb','Reverb Send',0,100,0,'%'],
      ['compThreshold','Comp Threshold',-60,0,-24,' dB'], ['compRatio','Comp Ratio',1,12,2.5,':1'],
      ['compAttack','Comp Attack',1,200,10,' ms'], ['compRelease','Comp Release',20,1000,120,' ms'],
      ['output','Output',-20,20,0,' dB']
    ];
    let html='<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;\">';
    for(const [p,label,mn,mx,dv,unit] of knobs){
      html+='<div style=\"display:flex;flex-direction:column;align-items:stretch;gap:3px;min-width:0;\">'
        +'<span style=\"color:#9ab;font-size:0.82em;font-weight:700;\">'+label+'</span>'
        +'<input type=\"range\" class=\"fxKnob\" data-slot=\"'+slot+'\" data-param=\"'+p+'\" min=\"'+mn+'\" max=\"'+mx+'\" step=\"'+(['midQ','compRatio'].includes(p)?'0.1':(p==='compAttack'||p==='compRelease'?'1':'0.1'))+'\" value=\"'+dv+'\" style=\"width:100%;accent-color:#38bdf8;\">'
        +'<span class=\"fxVal\" data-for=\"'+p+'\" style=\"color:#7dd3fc;font-size:0.78em;\">'+dv+unit+'</span>'
        +'</div>';
    }
    html+='</div><div style=\"display:flex;gap:20px;margin-top:8px;justify-content:center;flex-wrap:wrap;\">'
      +'<label style=\"display:flex;align-items:center;gap:5px;color:#9ab;cursor:pointer;\"><input type=\"checkbox\" class=\"fxToggle\" data-slot=\"'+slot+'\" data-fx=\"compressor\" style=\"accent-color:#10b981;\">Compressor</label>'
      +'<label style=\"display:flex;align-items:center;gap:5px;color:#9ab;cursor:pointer;\"><input type=\"checkbox\" class=\"fxToggle\" data-slot=\"'+slot+'\" data-fx=\"eq\" checked style=\"accent-color:#10b981;\">EQ</label>'
      +'</div><div style=\"color:#64748b;font-size:0.75em;margin-top:5px;\">Noise gate removed from controls: NAM input has no physical pickup hum to gate. IR/cab on-off remains independent.</div>';
    fp.innerHTML=html;
    const _unitOf={}; for(const [p,,,,,u] of knobs){ _unitOf[p]=u; }
    // wire knobs
    fp.querySelectorAll('.fxKnob').forEach(k=>{
      k.addEventListener('input',()=>{
        const raw=parseFloat(k.value), param=k.dataset.param, unit=(knobs.find(x=>x[0]===param)||[])[5]||'';
        const val=(param==='compAttack'||param==='compRelease')?raw/1000:raw;
        window.ensureAudio&&window.ensureAudio();
        NAMRealtime.setParam(k.dataset.slot, param, val);
        const vs=fp.querySelector('.fxVal[data-for="'+param+'"]'); if(vs) vs.textContent=(Number.isInteger(raw)?String(raw):raw.toFixed(1))+unit;
      });
    });
    fp.querySelectorAll('.fxToggle').forEach(t=>{
      t.addEventListener('change',()=>{
        window.ensureAudio&&window.ensureAudio();
        NAMRealtime.setFxEnabled(t.dataset.slot, t.dataset.fx, t.checked);
      });
    });
  }
  ['pedal','amp','cab'].forEach(buildFxPanel);

  // ── RIG SNAPSHOTS — A-G (7 slots). Captures pedal/amp jsons+tiers, IR buffer,
  //    on/off states, all fx knob values + gate/eq toggles. ──
  const SNAPS=[null,null,null,null,null,null,null];
  const SNAP_LABELS='ABCDEFG';
  let snapSaveMode=false;
  const snapStat=document.getElementById('rigSnapStat');
  function snapBtn(i){ return panel && panel.querySelector('.rigSnap[data-snap="'+i+'"]'); }
  function paintSnaps(){
    for(let i=0;i<7;i++){ const b=snapBtn(i); if(!b) continue;      // v681: A-G, seven slots
      const has=!!SNAPS[i];
      const hue=b.dataset.hue||'#fbbf24';                            // its note colour: A red, B yellow, C white...
      b.style.color = has ? '#0b0b0b' : hue;                         // filled = solid colour chip, empty = outline
      b.style.background = has ? hue : (snapSaveMode ? '#2a1a05' : 'rgba(10,10,10,0.55)');
      b.style.borderColor = snapSaveMode ? '#b45309' : hue;
      b.style.boxShadow = has ? ('0 0 8px '+hue+'88') : 'none';
      b.style.opacity = has ? '1' : '0.75';
    }
    const sv=panel.querySelector('.rigSnapSave');
    if(sv){ sv.style.background=snapSaveMode?'#b45309':'#2a1a05'; sv.style.color=snapSaveMode?'#000':'#fbbf24'; }
  }
  function grabFx(slot){
    const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]'); const o={knobs:{},gate:false,eq:true};
    if(!fp||!fp._built) return o;
    fp.querySelectorAll('.fxKnob').forEach(k=>{ o.knobs[k.dataset.param]=parseFloat(k.value); });
    fp.querySelectorAll('.fxToggle').forEach(t=>{ o[t.dataset.fx]=t.checked; });
    return o;
  }
  // AudioBuffers can't be structured-cloned into IndexedDB — flatten to raw channel data.
  function serializeIR(buf){
    if(!buf) return null;
    const chans=[]; for(let c=0;c<buf.numberOfChannels;c++) chans.push(new Float32Array(buf.getChannelData(c)));
    return { sampleRate:buf.sampleRate, length:buf.length, chans };
  }
  function deserializeIR(o){
    if(!o||!o.chans||!o.chans.length) return null;
    const ac=window.getAC&&window.getAC(); if(!ac) return null;
    const buf=ac.createBuffer(o.chans.length, o.length, o.sampleRate);
    for(let c=0;c<o.chans.length;c++) buf.getChannelData(c).set(o.chans[c]);
    return buf;
  }
  function snapCapture(){
    return {
      pedal:{ json:S.pedal.json, loaded:S.pedal.loaded, toneId:S.pedal.toneId||null, modelId:S.pedal.modelId||null, modelName:S.pedal.modelName||'', toneTitle:S.pedal.toneTitle||'', variants:S.pedal.variants||[], tier:(()=>{const s=slotEl('pedal').querySelector('.rigTier');return s&&s.style.display!=='none'?parseFloat(s.value):null;})(), name:slotEl('pedal').querySelector('.rigName').textContent, fx:grabFx('pedal') },
      amp:{ json:S.amp.json, loaded:S.amp.loaded, toneId:S.amp.toneId||null, modelId:S.amp.modelId||null, modelName:S.amp.modelName||'', toneTitle:S.amp.toneTitle||'', variants:S.amp.variants||[], tier:(()=>{const s=slotEl('amp').querySelector('.rigTier');return s&&s.style.display!=='none'?parseFloat(s.value):null;})(), name:slotEl('amp').querySelector('.rigName').textContent, fx:grabFx('amp') },
      cab:{ toneId:S.cab.toneId||null, modelId:S.cab.modelId||null, modelName:S.cab.modelName||'', toneTitle:S.cab.toneTitle||'', variants:S.cab.variants||[], buf:(window._IRCAB&&window._IRCAB.buffer)||null, ir:serializeIR((window._IRCAB&&window._IRCAB.buffer)||null), loaded:S.cab.loaded, name:slotEl('cab').querySelector('.rigName').textContent, fx:grabFx('cab') },
      on:{ pedal:NAMRealtime.pedalOn, amp:NAMRealtime.ampOn, ir:NAMRealtime.irOn }
    };
  }
  // strip the live AudioBuffer before persisting (keeps only the serializable `ir`)
  function snapForDisk(sn){
    const c=Object.assign({},sn);
    c.cab=Object.assign({},sn.cab); delete c.cab.buf;
    return c;
  }
  function persistSnap(i){
    const data=SNAPS[i]?snapForDisk(SNAPS[i]):null;
    const jobs=[];
    try{
      const st=window.SampleStore;
      if(st){
        if(data&&st.saveSnap) jobs.push(Promise.resolve(st.saveSnap(i,data)));
        else if(!data&&st.delSnap) jobs.push(Promise.resolve(st.delSnap(i)));
      }
    }catch(e){ console.warn('[snap persist: SampleStore]',e); }
    // Keep the cross-build Vault store in sync too; the export/import module reads this store.
    try{
      const vault=window.RigSnapStore;
      if(vault){
        if(data&&vault.save) jobs.push(Promise.resolve(vault.save(i,data)));
        else if(!data&&vault.drop) jobs.push(Promise.resolve(vault.drop(i)));
      }
    }catch(e){ console.warn('[snap persist: Vault]',e); }
    return Promise.all(jobs).catch(e=>console.warn('[snap persist]',e));
  }
  // restore all four slots from IndexedDB on boot
  async function loadSnapsFromDisk(){
    try{
      const st=window.SampleStore, vault=window.RigSnapStore;
      for(let i=0;i<7;i++){
        let d=null;
        if(st&&st.loadSnap) d=await st.loadSnap(i);
        if(!d&&vault&&vault.load) d=await vault.load(i);
        if(d){ if(d.cab&&d.cab.ir) d.cab.buf=null;   // rebuilt lazily on recall (needs live AudioContext)
               SNAPS[i]=d; }
      }
      paintSnaps();
    }catch(e){ console.warn('[snap load]',e); }
  }
  function restoreFx(slot, fx){
    const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]'); if(!fp||!fp._built||!fx) return;
    fp.querySelectorAll('.fxKnob').forEach(k=>{ const p=k.dataset.param;
      if(fx.knobs[p]!=null){ k.value=fx.knobs[p];
        const raw=parseFloat(fx.knobs[p]); const val=(p==='compAttack'||p==='compRelease')?raw/1000:raw;
        NAMRealtime.setParam(slot,p,val);
        const unit=({'input':' dB','output':' dB','lowCut':' Hz','highCut':' Hz','bassFreq':' Hz','midFreq':' Hz','midQ':'','trebleFreq':' Hz','compThreshold':' dB','compRatio':':1','compAttack':' ms','compRelease':' ms','reverb':'%'})[p]||'';
        const vs=fp.querySelector('.fxVal[data-for="'+p+'"]'); if(vs) vs.textContent=(Number.isInteger(raw)?String(raw):raw.toFixed(1))+unit; } });
    fp.querySelectorAll('.fxToggle').forEach(t=>{ const want=!!fx[t.dataset.fx];
      if(t.checked!==want){ t.checked=want; NAMRealtime.setFxEnabled(slot,t.dataset.fx,want); } });
  }
  async function snapRecall(i){
    const sn=SNAPS[i]; if(!sn){ snapStat.textContent='slot '+(SNAP_LABELS[i]||i)+' empty — tap SAVE then '+(SNAP_LABELS[i]||i); setTimeout(()=>snapStat.textContent='',2500); return; }
    window.ensureAudio&&window.ensureAudio();
    setStat('recalling '+(SNAP_LABELS[i]||i)+'…');
    // pedal
    S.pedal.json=sn.pedal.json; S.pedal.loaded=sn.pedal.loaded; S.pedal.toneId=sn.pedal.toneId||null; S.pedal.modelId=sn.pedal.modelId||null; S.pedal.modelName=sn.pedal.modelName||''; S.pedal.toneTitle=sn.pedal.toneTitle||''; S.pedal.variants=sn.pedal.variants||[];
    const pSel=slotEl('pedal').querySelector('.rigTier');
    if(sn.pedal.loaded&&sn.pedal.json){
      const pt=NAMEngine.tiers(sn.pedal.json);
      if(pt&&pSel){ pSel.innerHTML=pt.map((t,j)=>'<option value="'+t+'">q'+t+(j===pt.length-1?' (smooth)':j===0?' (heavy)':'')+'</option>').join('');
        pSel.value=String(sn.pedal.tier!=null?sn.pedal.tier:(function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(pt)); pSel.style.display='inline-block'; }   // v615: restore defaults to ~q0.64
      else if(pSel){ pSel.style.display='none'; pSel.innerHTML=''; }
      NAMRealtime.setModel('pedal',sn.pedal.json,sn.pedal.tier);
    } else if(pSel){ pSel.style.display='none'; pSel.innerHTML=''; }
    slotEl('pedal').querySelector('.rigName').textContent=sn.pedal.name||''; refreshVariantSelect('pedal'); if(S.pedal.toneId&&!S.pedal.variants.length) hydrateVariants('pedal');
    // amp
    S.amp.json=sn.amp.json; S.amp.loaded=sn.amp.loaded; S.amp.toneId=sn.amp.toneId||null; S.amp.modelId=sn.amp.modelId||null; S.amp.modelName=sn.amp.modelName||''; S.amp.toneTitle=sn.amp.toneTitle||''; S.amp.variants=sn.amp.variants||[];
    const aSel=slotEl('amp').querySelector('.rigTier');
    if(sn.amp.loaded&&sn.amp.json){
      const at=NAMEngine.tiers(sn.amp.json);
      if(at&&aSel){ aSel.innerHTML=at.map((t,j)=>'<option value="'+t+'">q'+t+(j===at.length-1?' (smooth)':j===0?' (heavy)':'')+'</option>').join('');
        aSel.value=String(sn.amp.tier!=null?sn.amp.tier:(function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(at)); aSel.style.display='inline-block'; }   // v615: restore defaults to ~q0.64
      else if(aSel){ aSel.style.display='none'; aSel.innerHTML=''; }
      NAMEngine.loadFromJSON(sn.amp.json, sn.amp.tier!=null?sn.amp.tier:undefined);
      NAMRealtime.setModel('amp',sn.amp.json,sn.amp.tier);
    } else if(aSel){ aSel.style.display='none'; aSel.innerHTML=''; }
    slotEl('amp').querySelector('.rigName').textContent=sn.amp.name||''; refreshVariantSelect('amp'); if(S.amp.toneId&&!S.amp.variants.length) hydrateVariants('amp');
    // cab — rebuild the AudioBuffer if this snap came from disk (buf stripped, ir kept)
    S.cab.loaded=sn.cab.loaded; S.cab.toneId=sn.cab.toneId||null; S.cab.modelId=sn.cab.modelId||null; S.cab.modelName=sn.cab.modelName||''; S.cab.toneTitle=sn.cab.toneTitle||''; S.cab.variants=sn.cab.variants||[];
    if(sn.cab.loaded && !sn.cab.buf && sn.cab.ir){ try{ sn.cab.buf=deserializeIR(sn.cab.ir); }catch(e){ console.warn('[snap IR rebuild]',e); } }
    NAMRealtime.setIR(sn.cab.loaded?sn.cab.buf:null);
    slotEl('cab').querySelector('.rigName').textContent=sn.cab.name||''; refreshVariantSelect('cab'); if(S.cab.toneId&&!S.cab.variants.length) hydrateVariants('cab');
    // one rewire with the snapshot's on-states, then knobs/toggles
    await NAMRealtime.route(!!(sn.on.pedal&&sn.pedal.loaded), !!(sn.on.amp&&sn.amp.loaded), !!(sn.on.ir&&sn.cab.loaded));
    restoreFx('pedal',sn.pedal.fx); restoreFx('amp',sn.amp.fx); restoreFx('cab',sn.cab.fx);
    paint(); toggleBtn(); setStat('');
    snapStat.textContent=(SNAP_LABELS[i]||i)+' ✓'; setTimeout(()=>snapStat.textContent='',1600);
  }
  const snapSaveBtn=panel.querySelector('.rigSnapSave');
  snapSaveBtn&&snapSaveBtn.addEventListener('click',()=>{
    snapSaveMode=!snapSaveMode;
    snapStat.textContent=snapSaveMode?'tap A–G to save':'';
    paintSnaps();
  });
  panel.querySelectorAll('.rigSnap').forEach(b=>{
    b.addEventListener('click',()=>{
      const i=parseInt(b.dataset.snap);
      if(snapSaveMode){ SNAPS[i]=snapCapture(); snapSaveMode=false;
        persistSnap(i);                                    // v539: survives reload
        snapStat.textContent='saved → '+(SNAP_LABELS[i]||i); setTimeout(()=>snapStat.textContent='',1600); paintSnaps(); }
      else snapRecall(i);
    });
  });
  paintSnaps();
  // SampleStore is defined further down this block — defer so it exists when we read it.
  setTimeout(()=>{ loadSnapsFromDisk(); }, 0);

  // Tier changes rebuild only the realtime model here. Rebuilding the legacy/offline
  // NAMEngine synchronously during live playback can stall the main thread while the
  // AudioWorklet is trying to stream audio. The worklet keeps the currently-running
  // model until the replacement has compiled and is ready to swap at a render-block
  // boundary, so a failed Q1.0 -> Q0.5 build leaves the previous model intact.
  // Offline export remains tied to the NAMEngine tier last loaded; it is deliberately
  // not rebuilt in this live-playback event handler.
  panel&&panel.addEventListener('change',(e)=>{
    if(!e.target.classList.contains('rigTier')) return;
    const slotDiv=e.target.closest('.rigSlot'); const slot=slotDiv?slotDiv.dataset.slot:'amp';
    const st=S[slot]; if(st&&st.json){
      try{ NAMRealtime.setModel(slot,st.json,parseFloat(e.target.value)); }
      catch(err){ console.warn('[rig] realtime tier change failed',err); }
    }
  });

  function clearSlot(slot){
    S[slot].toneId=null; S[slot].modelId=null; S[slot].modelName=''; S[slot].toneTitle=''; S[slot].variants=[]; refreshVariantSelect(slot);
    if(slot==='cab'){ S.cab.loaded=false; NAMRealtime.setIR(null);
      NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, false).then(()=>{paint();toggleBtn();}); }
    else { S[slot].loaded=false; S[slot].json=null;
      const on = slot==='pedal'?[false,NAMRealtime.ampOn,NAMRealtime.irOn]:[NAMRealtime.pedalOn,false,NAMRealtime.irOn];
      const t=slotEl(slot).querySelector('.rigTier'); if(t){t.style.display='none';t.innerHTML='';}
      NAMRealtime.route(on[0],on[1],on[2]).then(()=>{paint();toggleBtn();}); }
    slotEl(slot).querySelector('.rigName').textContent='';
    setStat('');
  }

  // ── file load ──
  fileNam&&fileNam.addEventListener('change',(e)=>{ const f=e.target.files[0]; if(f) loadNamFile(f, fileTargetSlot); });
  fileIr&&fileIr.addEventListener('change',(e)=>{ const f=e.target.files[0]; if(f) loadIrFile(f); });

  function loadNamFile(f, slot){
    setStat('loading '+slot+'…');
    const isZip=/\.zip$/i.test(f.name)||f.type==='application/zip';
    (isZip?extractNamFromZip(f):f.text()).then(txt=>applyNam(txt, slot, f.name)).catch(err=>setStat(slot+' load failed: '+err.message));
  }
  function applyNam(txt, slot, label){
    const json=JSON.parse(txt); S[slot].json=json; S[slot].loaded=true; S[slot].toneId=null; S[slot].modelId=null; S[slot].modelName=''; S[slot].toneTitle=''; S[slot].variants=[]; refreshVariantSelect(slot);
    window.ensureAudio&&window.ensureAudio();
    if(slot==='amp'){
      const tiers=NAMEngine.tiers(json); const tierSel=slotEl('amp').querySelector('.rigTier');
      if(tiers){ tierSel.innerHTML=tiers.map((t,i)=>'<option value="'+t+'">q'+t+(i===tiers.length-1?' (smooth)':i===0?' (heavy)':'')+'</option>').join('');
        const _dt=(function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(tiers);   // v615: default = tier nearest q0.64 (user-tested sweetspot q0.5-1.0)
        tierSel.value=String(_dt); tierSel.style.display='inline-block';
        NAMEngine.loadFromJSON(json,_dt); }
      else { tierSel.style.display='none'; NAMEngine.loadFromJSON(json); }
      NAMRealtime.setModel('amp',json, tiers?parseFloat(tierSel.value):null);
      NAMRealtime.route(NAMRealtime.pedalOn, true, NAMRealtime.irOn).then(()=>{paint();toggleBtn();});
    } else { // pedal
      const ptiers=NAMEngine.tiers(json); const pSel=slotEl('pedal').querySelector('.rigTier');
      if(ptiers && pSel){ pSel.innerHTML=ptiers.map((t,i)=>'<option value="'+t+'">q'+t+(i===ptiers.length-1?' (smooth)':i===0?' (heavy)':'')+'</option>').join('');
        pSel.value=String((function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(ptiers)); pSel.style.display='inline-block';   // v615: default = tier nearest q0.64
        NAMRealtime.setModel('pedal',json,parseFloat(pSel.value));
      } else { if(pSel){pSel.style.display='none';pSel.innerHTML='';} NAMRealtime.setModel('pedal',json,null); }
      NAMRealtime.route(true, NAMRealtime.ampOn, NAMRealtime.irOn).then(()=>{paint();toggleBtn();});
    }
    slotEl(slot).querySelector('.rigName').textContent=label||'loaded';
    setStat('');
  }
  function loadIrFile(f){
    S.cab.toneId=null; S.cab.modelId=null; S.cab.modelName=''; S.cab.toneTitle=''; S.cab.variants=[]; refreshVariantSelect('cab');
    setStat('loading cab…');
    window.ensureAudio&&window.ensureAudio();
    const ac=window.getAC&&window.getAC();
    f.arrayBuffer().then(ab=>ac.decodeAudioData(ab)).then(buf=>{
      NAMRealtime.setIR(buf); S.cab.loaded=true;
      slotEl('cab').querySelector('.rigName').textContent=f.name;
      NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, true).then(()=>{paint();toggleBtn();});
      setStat('');
    }).catch(err=>setStat('cab load failed: '+err.message));
  }

  // ── TONE3000 search (per-slot target) ──
  const modal=document.getElementById('t3kModal'), t3kClose=document.getElementById('t3kClose');
  const t3kQuery=document.getElementById('t3kQuery'), t3kGo=document.getElementById('t3kGo');
  const t3kGear=document.getElementById('t3kGear'), t3kFormat=document.getElementById('t3kFormat');
  const t3kSort=document.getElementById('t3kSort'), t3kFav=document.getElementById('t3kFav');
  const t3kResults=document.getElementById('t3kResults'), t3kPager=document.getElementById('t3kPager');
  let curPage=1;
  // When launched from the stereo NAM8 rig, keep its exact destination while using the legacy image-rich store.
  let t3kNAM8Target=null;
  t3kClose&&t3kClose.addEventListener('click',()=>{ modal.style.display='none'; t3kNAM8Target=null; });

  function openT3k(slot){
    t3kTargetSlot=slot;
    if(location.protocol!=='https:'){ setStat('T3K search needs https hosting; use 📁 File here'); return; }
    if(!T3K.configured()){ setStat('T3K: set publishable key (line 108)'); return; }
    if(!T3K.connected()){ setStat('connecting to TONE3000…'); T3K.connect().catch(err=>setStat('connect failed: '+err.message)); return; }
    // preset format filter to slot
    if(t3kFormat) t3kFormat.value = (slot==='cab')?'ir':'nam';
    modal.style.display='flex'; curPage=1; runSearch();
  }
  function escapeT3k(value){ return String(value==null?'':value).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];}); }
  function t3kImageUrl(tone,model){
    function find(raw,depth){
      if(!raw||depth>3)return '';
      if(Array.isArray(raw)){for(const item of raw){const u=find(item,depth+1);if(u)return u;}return '';}
      if(typeof raw==='string'){const u=raw.trim();if(/^https?:\/\//i.test(u))return u;if(/^\/\//.test(u))return 'https:'+u;return '';}
      if(typeof raw==='object'){
        for(const key of ['url','src','original','full_url','large_url','thumbnail_url','image_url','thumbnail','image','path']){
          if(raw[key]){const u=find(raw[key],depth+1);if(u)return u;}
        }
      }
      return '';
    }
    const candidates=[tone&&tone.images,tone&&tone.image_url,tone&&tone.thumbnail_url,tone&&tone.cover_url,tone&&tone.cover_image,tone&&tone.image,
      model&&model.images,model&&model.image_url,model&&model.thumbnail_url,model&&model.thumbnail,model&&model.image];
    for(const raw of candidates){const url=find(raw,0);if(url)return url;}
    return '';
  }
  async function enrichToneForChain(tone,model){
    let enriched=tone||{},thumbnail=t3kImageUrl(enriched,model);
    if(!thumbnail&&enriched.id!=null&&T3K&&typeof T3K.getTone==='function'){
      try{const raw=await T3K.getTone(enriched.id),detail=raw&&(raw.data||raw);if(detail&&typeof detail==='object'){enriched=Object.assign({},enriched,detail);thumbnail=t3kImageUrl(enriched,model);}}
      catch(e){console.warn('[T3K] tone-image metadata lookup failed',e);}
    }
    return {tone:enriched,thumbnail};
  }
  async function loadTone(tone){
    t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#7dd3fc;">Loading variants for '+escapeT3k(tone.title||'tone')+'…</div>';
    if(t3kPager) t3kPager.innerHTML='';
    try{
      const res=await T3K.listModels(tone.id); const models=res.data||res;
      if(!models||!models.length){ t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">No models available for this tone in the selected architecture.</div>'; return; }
      tone.models=models;
      // Preserve explicit model choice: show A2 Lite, A2 Full, and any other variants
      // instead of silently auto-loading one. This also avoids cross-IIFE
      // ReferenceError from the newer modal's private preferredA2Lite helper.
      if(models.length===1 && !t3kNAM8Target){ await loadToneModel(tone,models[0]); return; }
      renderModelVariants(tone,models);
    }catch(err){ const msg=(err&&err.message)||(typeof err==='string'?err:'network/CORS error');
      t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">Could not load variants: '+escapeT3k(msg)+'</div>';
      console.warn('[T3K] model list failed:',err); }
  }
  function renderModelVariants(tone,models){
    t3kResults.innerHTML='<div style="padding:10px 7px;color:#7dd3fc;font-weight:900;">Choose a model · '+escapeT3k(tone.title||'TONE3000 tone')+'</div>'+models.map((m,i)=>
      '<div class="t3kModelRow" data-i="'+i+'" style="display:flex;gap:10px;align-items:center;padding:12px 9px;border-bottom:1px solid #222;cursor:pointer;">'+
      '<div style="flex:1;min-width:0;"><div style="color:#e2e8f0;font-weight:900;font-size:0.9em;overflow-wrap:anywhere;">'+escapeT3k(m.name||('Model '+(i+1)))+'</div>'+ 
      '<div style="color:#64748b;font-size:0.72em;margin-top:3px;">Model ID '+escapeT3k(m.id==null?'unknown':m.id)+'</div></div><span style="color:#38bdf8;font-size:1.2em;flex-shrink:0;">▸</span></div>').join('')+
      '<button type="button" id="t3kVariantsBack" style="margin:10px 7px;padding:7px 12px;background:#334155;color:#fff;border:0;border-radius:6px;">← Back to search results</button>';
    t3kResults.querySelectorAll('.t3kModelRow').forEach(row=>row.addEventListener('click',()=>loadToneModel(tone,models[parseInt(row.dataset.i,10)])));
    const back=document.getElementById('t3kVariantsBack'); if(back) back.addEventListener('click',()=>runSearch());
  }
  async function loadToneModel(tone,model,opts){
    opts=opts||{};
    if(!model){ setStat('No model variant selected'); return; }
    t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#7dd3fc;">Loading '+escapeT3k(model.name||'model')+'…</div>';
    if(t3kPager) t3kPager.innerHTML='';
    try{
      // Resolve by model ID against the current API list, rather than trusting stale picker data.
      if(T3K.resolveModel){const resolved=await T3K.resolveModel(tone.id,model);model=resolved.model;if(resolved.variants&&resolved.variants.length)tone.models=resolved.variants;}
      if(!model.model_url) throw new Error('This variant has no downloadable model URL');
      const blob=await T3K.downloadModel(model.model_url); const slot=opts.slotOverride||t3kTargetSlot||'amp';
      const isIR=t3kNAM8Target ? t3kNAM8Target.format==='ir' : ((tone.format==='ir')||(slot==='cab'));
      let displayTone=tone||{},thumbnail=t3kImageUrl(displayTone,model);
      if(t3kNAM8Target&&!thumbnail){const enriched=await enrichToneForChain(displayTone,model);displayTone=enriched.tone;thumbnail=enriched.thumbnail;}
      const label=(displayTone.title||displayTone.name||'TONE3000 tone')+(model.name?' — '+model.name:'');
      if(t3kNAM8Target && window.NAM8){
        // The legacy store UI is reused, but loads into the selected stereo-rig slot.
        if(isIR){
          const ac=window.getAC&&window.getAC();
          if(!ac) throw new Error('Audio engine is not ready');
          const buf=await ac.decodeAudioData(await blob.arrayBuffer());
          const side=t3kNAM8Target.target;
          if(side==='BOTH'){ await window.NAM8.setIR('ALL',buf,{name:label,toneId:displayTone.id||tone.id,modelId:model.id,modelName:model.name,toneTitle:displayTone.title||displayTone.name||'',thumbnail,enabled:true}); }
          else await window.NAM8.setIR(side,buf,{name:label,toneId:displayTone.id||tone.id,modelId:model.id,modelName:model.name,toneTitle:displayTone.title||displayTone.name||'',thumbnail,enabled:true});
        }else{
          const json=JSON.parse(await blob.text());
          let variants=[];
          try{const vr=await T3K.listModels(displayTone.id||tone.id);variants=Array.isArray(vr)?vr:(vr&&((vr.data)||(vr.models)))||[];}catch(e){console.warn('[T3K] variant metadata unavailable',e);}
          if(!variants.some(x=>String(x.id)===String(model.id)))variants.push(model);
          await window.NAM8.setModel(t3kNAM8Target.target,json,{name:label,toneId:displayTone.id||tone.id,modelId:model.id,modelName:model.name||'',toneTitle:displayTone.title||displayTone.name||'',variants,thumbnail,enabled:true});
        }
      }else{
        if(isIR){ await loadIrBlob(blob,label); }
        else { applyNam(await blob.text(),slot==='cab'?'amp':slot,label); }
        const target=isIR?'cab':(slot==='cab'?'amp':slot);
        if(S[target]){ S[target].toneId=String(tone.id); S[target].modelId=model.id==null?null:String(model.id); S[target].modelName=model.name||''; S[target].toneTitle=tone.title||tone.name||S[target].toneTitle||'';
          if(Array.isArray(tone.models)) S[target].variants=tone.models;
          if(!S[target].variants||!S[target].variants.length) { try{ const vr=await T3K.listModels(tone.id); S[target].variants=(vr&&vr.data)||vr||[]; }catch(e){ S[target].variants=[model]; } }
          refreshVariantSelect(target); }
      }
      if(opts.keepModal!==true){ modal.style.display='none'; t3kNAM8Target=null; }
    }catch(err){ const msg=(err&&err.message)||(typeof err==='string'?err:'network/CORS error');
      t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">Load failed: '+escapeT3k(msg)+'</div>';
      console.warn('[T3K] model load failed:',err); }
  }
  function loadIrBlob(blob, name){
    window.ensureAudio&&window.ensureAudio(); const ac=window.getAC&&window.getAC();
    if(!ac) return Promise.reject(new Error('Audio engine is not ready'));
    return blob.arrayBuffer().then(ab=>ac.decodeAudioData(ab)).then(buf=>{
      NAMRealtime.setIR(buf); S.cab.loaded=true;
      slotEl('cab').querySelector('.rigName').textContent=name;
      return NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, true).then(()=>{paint();toggleBtn();});
    }).catch(err=>{setStat('cab load failed: '+err.message); throw err;});
  }
  function renderResults(data){
    const tones=data.data||[];
    if(!tones.length){ t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#9aa;">No results.</div>'; t3kPager.innerHTML=''; return; }
    t3kResults.innerHTML=tones.map((t,i)=>{
      const img=t3kImageUrl(t,null);
      const dl=t.downloads_count!=null?('↓'+t.downloads_count):'';
      return '<div class="t3kRow" data-i="'+i+'" style="display:flex;gap:8px;align-items:center;padding:7px;border-bottom:1px solid #222;cursor:pointer;">'
        +(img?'<img src="'+escapeT3k(img)+'" alt="'+escapeT3k(t.title||'TONE3000 tone')+'" loading="lazy" style="width:42px;height:42px;object-fit:cover;border-radius:5px;flex-shrink:0;">':'<div style="width:42px;height:42px;background:#1f2937;border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#7dd3fc;font-size:10px;font-weight:800;">T3K</div>')
        +'<div style="flex:1;min-width:0;"><div style="color:#e2e8f0;font-weight:900;font-size:0.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(t.title||'Untitled')+'</div>'
        +'<div style="color:#64748b;font-size:0.72em;">'+(t.gear||t.format||'')+' · @'+((t.user&&t.user.username)||'?')+' '+dl+'</div></div>'
        +'<span style="color:#38bdf8;font-size:1.2em;flex-shrink:0;">▸</span></div>';
    }).join('');
    t3kResults.querySelectorAll('.t3kRow').forEach(row=>row.addEventListener('click',()=>loadTone(tones[parseInt(row.dataset.i)])));
    const tp=data.total_pages||1, pg=data.page||1;
    t3kPager.innerHTML='<button '+(pg<=1?'disabled':'')+' id="t3kPrev" style="padding:4px 10px;background:#334155;color:#fff;border:none;border-radius:5px;cursor:pointer;">‹ Prev</button>'
      +'<span style="color:#64748b;align-self:center;">Page '+pg+' / '+tp+'</span>'
      +'<button '+(pg>=tp?'disabled':'')+' id="t3kNext" style="padding:4px 10px;background:#334155;color:#fff;border:none;border-radius:5px;cursor:pointer;">Next ›</button>';
    const pv=document.getElementById('t3kPrev'), nx=document.getElementById('t3kNext');
    pv&&pv.addEventListener('click',()=>{ if(curPage>1){curPage--; runSearch();} });
    nx&&nx.addEventListener('click',()=>{ if(curPage<tp){curPage++; runSearch();} });
  }
  async function runSearch(){
    t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#7dd3fc;">searching…</div>';
    try{
      const query=t3kQuery.value.trim();
      if(/^\d+$/.test(query)){
        const res=await T3K.getTone(query); const tone=res&&res.data?res.data:res;
        if(!tone||!tone.id) throw new Error('No tone found for ID '+query);
        if(t3kFormat&&t3kFormat.value&&tone.format&&String(tone.format).toLowerCase()!==String(t3kFormat.value).toLowerCase()){
          t3kResults.innerHTML='<div style="padding:20px;color:#fbbf24;">Tone ID '+escapeT3k(query)+' is format '+escapeT3k(tone.format)+', but the current filter is '+escapeT3k(t3kFormat.value)+'. Change the format filter and try again.</div>'; if(t3kPager)t3kPager.innerHTML=''; return;
        }
        renderResults({data:[tone],page:1,total_pages:1});
      } else renderResults(await T3K.search({ query, gears:t3kGear.value, format:t3kFormat.value, sort:t3kSort.value, page:curPage, page_size:20 }));
    }catch(err){ const msg=err.message||'';
      if(/not connected|401/.test(msg)){ t3kResults.innerHTML='<div style="padding:20px;color:#fbbf24;">Session expired — reconnecting…</div>'; T3K.connect().catch(e=>{t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">'+escapeT3k(e.message)+'</div>';}); return; }
      t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">Search failed: '+escapeT3k(msg)+'</div>'; if(t3kPager)t3kPager.innerHTML=''; }
  }
  t3kGo&&t3kGo.addEventListener('click',()=>{ curPage=1; runSearch(); });
  t3kQuery&&t3kQuery.addEventListener('keydown',e=>{ if(e.key==='Enter'){ curPage=1; runSearch(); } });
  [t3kGear,t3kFormat,t3kSort].forEach(sel=>sel&&sel.addEventListener('change',()=>{ curPage=1; runSearch(); }));
  t3kFav&&t3kFav.addEventListener('click',async ()=>{ t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#fbbf24;">loading favorites…</div>';
    try{ renderResults(await T3K.favorited(1)); }catch(err){ t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">'+err.message+'</div>'; } });

  // Bridge the newer stereo rig's T3K buttons to the original image-rich store.
  // The store keeps its filters, images, sorting, favorites and paging, but loads into NAM8.
  window.__openLegacyT3KForNAM8=function(target,format){
    t3kNAM8Target={target:target,format:format};
    t3kTargetSlot=format==='ir'?'cab':'amp';
    if(t3kFormat)t3kFormat.value=format==='ir'?'ir':'nam';
    if(t3kGear)t3kGear.value=format==='ir'?'cab':'';
    if(!T3K.configured()){setStat('TONE3000 is not configured');return;}
    if(!T3K.connected()){
      sessionStorage.setItem('t3k_new_search_return',JSON.stringify({target:target,format:format}));
      setStat('connecting to TONE3000…');
      T3K.connect().catch(err=>setStat('connect failed: '+(err.message||err)));
      return;
    }
    modal.style.display='flex';curPage=1;runSearch();
  };

  // handle OAuth return - v698: ONLY when the URL actually carries an OAuth callback. Before,
  //   this ran handleCallback() on every load; on desktop it returned truthy with no real
  //   callback, force-opening the T3K search modal on startup (the 'LOAD FAILED: UNDEFINED'
  //   box over the fretboard). Gate it on the redirect params being present.
  (async function(){
    if(!T3K.configured()) return;
    try{
      var qs=location.search||''; var hs=location.hash||'';
      var hasCb=/[?&#](code|state|access_token|error)=/.test(qs) || /[?&#](code|state|access_token|error)=/.test(hs);
      if(!hasCb) return;                       // no OAuth redirect -> never auto-open on load
      var cb=await T3K.handleCallback();
      if(cb){
        // Restore the newer NAM/IR search if OAuth was launched from that modal.
        // Otherwise retain the legacy store's existing callback behavior.
        var pendingNewSearch=sessionStorage.getItem('t3k_new_search_return');
        if(pendingNewSearch){
          sessionStorage.removeItem('t3k_new_search_return');
          var pendingTarget={target:'L1',format:'nam'};
          try{ pendingTarget=Object.assign(pendingTarget,JSON.parse(pendingNewSearch)||{}); }catch(_e){}
          if(window.__openLegacyT3KForNAM8) window.__openLegacyT3KForNAM8(pendingTarget.target,pendingTarget.format);
          else { openT3K(pendingTarget.target,pendingTarget.format); searchT3K(); }
        }else{
          panel.style.display='flex'; modal.style.display='flex'; curPage=1; runSearch();
        }
      }
    }catch(e){ console.warn('[T3K cb]', e&&e.message); }
  })();

  window._namRtOverrun=function(slot){ setStat('⚠ '+(slot||'')+' CPU high, lower quality'); };
  window._namRtOnError=function(msg,slot){ setStat((slot||'amp')+' error: '+msg); };
  window._namActive=function(){ return NAMRealtime.ampOn && NAMEngine.loaded; };

  // Public bridge used by modules/snapshot/snapshots.js; keeps the actual rig state private.
  window.RigSnapshotBridge={
    version:MODULE_VERSION,
    getSnapshot:function(i){ return SNAPS[i]||null; },
    getSnapshotForDisk:function(i){ return SNAPS[i]?snapForDisk(SNAPS[i]):null; },
    loadFromDisk:function(){ return loadSnapsFromDisk(); },
    capture:function(){ return snapCapture(); },
    saveCurrent:async function(i){ if(i<0||i>6) throw new Error('Snapshot index must be 0–6'); SNAPS[i]=snapCapture(); await persistSnap(i); paintSnaps(); return SNAPS[i]; },
    clearIR:function(){ clearSlot('cab'); },
    recall:function(i){ return snapRecall(i); },
    loadT3KModel:async function(slot,tone,model){ t3kTargetSlot=slot; await loadToneModel(tone,model); },
    setStatus:function(msg){ setStat(msg); }
  };

})(); // end RIG UI IIFE (was missing — syntax error killed all RIG buttons)

window.registerModule('rig', {
  version: MODULE_VERSION,
  isStub: false,
  NAMRealtime: window.NAMRealtime,
  T3K: window.T3K
});
console.log('[modules] rig v' + MODULE_VERSION);
}

// Ensure offline NAM engine present (real module, not shell stub), then boot RIG stack
function namReady(){
  return window.__MODULES && window.__MODULES.nam && !window.__MODULES.nam.isStub;
}
// Boot RIG UI immediately so OFF / File / T3K / SNAP work even while NAM loads.
// NAMEngine stub already exists in the shell; real nam module upgrades it.
try { boot(); } catch(e){ console.warn('[rig] boot error', e); }
if(typeof window.loadModule === 'function'){
  window.loadModule('snapshot').catch(function(e){ console.warn('[snapshot] module load failed',e); });
}
if(!namReady() && typeof window.loadModule === 'function'){
  window.loadModule('nam').catch(function(e){
    console.warn('[rig] nam load failed', e);
  });
}
})();

/* IMPROVS2 Build 929 — Build 925 audio path + per-slot NAM diagnostics. */
(function(){
'use strict';
if(window.__IMPROVS2_NAM8_INSTALLED) return;
window.__IMPROVS2_NAM8_INSTALLED=true;
const VERSION='4.9.8.930';
const SIDES=['R'];
const NAM_KEYS=['R1','R2','R3','R4','R5','R6','R7','R8'];
const IR_KEYS=['IR1','IR2','IR3','IR4'];
const IR_SIDE_KEYS={R:IR_KEYS};
const LABELS={}; NAM_KEYS.forEach(k=>LABELS[k]='NAM '+k);
const SLOT_DSP_DEFAULT={inputDb:0,drive:0,outputDb:0,mix:100,clip:0,eqOn:true,lowCut:70,bassFreq:120,bass:5,midFreq:750,midQ:0.8,middle:5,trebleFreq:3000,treble:5,highCut:12000};
const IR_FX_DEFAULT={inputDb:0,outputDb:0,mix:100,clip:0,eqOn:true,lowCut:70,bassFreq:120,bass:5,midFreq:750,midQ:0.8,middle:5,trebleFreq:3000,treble:5,highCut:12000};
const NAM={}; NAM_KEYS.forEach(k=>NAM[k]={key:k,loaded:false,json:null,tier:null,enabled:true,name:'Empty',toneId:null,modelId:null,modelName:'',toneTitle:'',thumbnail:'',variants:[],node:null,compiled:false,compileToken:0,rateWarning:'',workletStatus:'not created',workletError:'',workletMeter:null,fx:Object.assign({},SLOT_DSP_DEFAULT)});
const EMPTY_IR=()=>({loaded:false,enabled:true,buffer:null,name:'Empty',toneId:null,modelId:null,modelName:'',toneTitle:'',thumbnail:'',fx:Object.assign({},IR_FX_DEFAULT)});
const IR={}; IR_KEYS.forEach(k=>IR[k]=EMPTY_IR());
const INPUT_MODE_KEY='improvs2.rig.inputMode';
function readSideInput(side){try{const v=window.localStorage.getItem(INPUT_MODE_KEY+'.'+side);if(['both','left','right'].includes(v))return v;}catch(e){}return 'both';}
const inputModes={L:readSideInput('L'),R:readSideInput('R')};
const NAMMODE_KEY='improvs2.rig.namMode';let namMode='dual';try{const v=window.localStorage.getItem(NAMMODE_KEY);if(['dual','singleL','singleR'].includes(v))namMode=v;}catch(e){}
function srcSideOf(){return null;}
const HALF_KEY='improvs2.rig.halfRate';let halfRate=false;try{window.localStorage.setItem(HALF_KEY,'0');}catch(e){}
const DSP_DEFAULT={enabled:false,compOn:false,eqOn:false,inputDb:0,drive:0,lowCut:70,bassFreq:120,bass:5,midFreq:750,midQ:0.8,middle:5,trebleFreq:3000,treble:5,highCut:12000,reverb:0,compThreshold:-24,compRatio:3,compAttack:20,compRelease:150,outputDb:0};
const DSP=Object.assign({},DSP_DEFAULT);
let ctx=null,source=null,graphSrc=null,graphCtx=null,inputSplitter=null,chainInputs={},chainOutputs={},masterNodes={},slotFx={},irNodes={},irFx={},outputMerger=null,outputGain=null,graphNodes=new Set(),routeQueue=Promise.resolve(),fileTarget=null,t3kTarget=null,snapshotSaveMode=false;
const SNAPSHOTS=[null,null,null,null,null,null,null];
let meters={},meterTok=0;
function el(id){return document.getElementById(id);}
function status(s){const n=el('rigStat');if(n)n.textContent=s||'';const n2=el('nam8Status');if(n2)n2.textContent=s||'';}
function audioContext(){try{if(typeof window.ensureAudio==='function')window.ensureAudio();}catch(e){}return (window.getAC&&window.getAC())||window._AC||null;}
function active(){return NAM_KEYS.some(k=>NAM[k].loaded&&NAM[k].enabled)||IR_KEYS.some(k=>IR[k].loaded&&IR[k].enabled&&IR[k].buffer)||!!DSP.enabled;}
// Mobile CPU budget: at most two loaded NAMs may be live in the signal chain.
const MAX_ACTIVE_NAMS=2;
function activeNAMKeys(except){return NAM_KEYS.filter(k=>k!==except&&NAM[k].loaded&&NAM[k].enabled);}
function enforceNAMBudget(){
 const on=NAM_KEYS.filter(k=>NAM[k].loaded&&NAM[k].enabled);
 if(on.length<=MAX_ACTIVE_NAMS)return [];
 const order=on.includes('R4')?['R4',...on.filter(k=>k!=='R4')]:on.slice();
 const keep=new Set(order.slice(0,MAX_ACTIVE_NAMS)),disabled=[];
 for(const k of on)if(!keep.has(k)){NAM[k].enabled=false;disabled.push(k);}
 return disabled;
}
function disposeNAMNode(key){
 const st=NAM[key],nd=st&&st.node;if(!nd)return;
 try{nd.port.postMessage({type:'unload'});}catch(e){}
 try{nd.disconnect();}catch(e){}
 try{nd.port.onmessage=null;nd.onprocessorerror=null;nd.port.close();}catch(e){}
 st.node=null;st.compiled=false;st.workletMeter=null;st.workletError='';
 st.workletStatus=st.loaded?'LOADED / IDLE':'not created';
}
function sideKeys(side){return NAM_KEYS.filter(k=>k[0]===side);}
function irSide(key){return Number(key.slice(2))<=2?'L':'R';}
function snapshotButton(i){return document.querySelector('#rigSnapRow .rigSnap[data-snap="'+i+'"]');}

function toneThumbnail(tone,model){
 function findImage(raw,depth){
  if(!raw||depth>3)return '';
  if(Array.isArray(raw)){for(const item of raw){const u=findImage(item,depth+1);if(u)return u;}return '';}
  if(typeof raw==='string'){const u=raw.trim();if(/^https?:\/\//i.test(u))return u;if(/^\/\//.test(u))return 'https:'+u;return '';}
  if(typeof raw==='object')for(const k of ['url','src','original','full_url','large_url','thumbnail_url','image_url','thumbnail','image','path'])if(raw[k]){const u=findImage(raw[k],depth+1);if(u)return u;}
  return '';
 }
 const candidates=[tone&&tone.images,tone&&tone.image_url,tone&&tone.thumbnail_url,tone&&tone.cover_url,tone&&tone.cover_image,tone&&tone.image,model&&model.images,model&&model.image_url,model&&model.thumbnail_url,model&&model.thumbnail,model&&model.image];
 for(const raw of candidates){const url=findImage(raw,0);if(url)return url;}
 return '';
}
const DSP_CONTROLS=[
 {key:'inputDb',label:'Master input gain',min:-20,max:20,step:0.5,unit:' dB'},
 {key:'drive',label:'Master drive',min:0,max:10,step:0.1,unit:' / 10'},
 {key:'lowCut',label:'Low cut',min:20,max:500,step:1,unit:' Hz'},
 {key:'bassFreq',label:'Bass frequency',min:40,max:500,step:1,unit:' Hz'},
 {key:'bass',label:'Bass level',min:0,max:10,step:0.1,unit:' / 10'},
 {key:'midFreq',label:'Mid frequency',min:100,max:8000,step:10,unit:' Hz'},
 {key:'midQ',label:'Mid Q',min:0.3,max:5,step:0.1,unit:''},
 {key:'middle',label:'Mid level',min:0,max:10,step:0.1,unit:' / 10'},
 {key:'trebleFreq',label:'Treble frequency',min:1000,max:12000,step:10,unit:' Hz'},
 {key:'treble',label:'Treble level',min:0,max:10,step:0.1,unit:' / 10'},
 {key:'highCut',label:'High cut',min:1000,max:20000,step:100,unit:' Hz'},
 {key:'reverb',label:'Reverb send',min:0,max:100,step:1,unit:'%'},
 {key:'compThreshold',label:'Compressor threshold',min:-60,max:0,step:1,unit:' dB'},
 {key:'compRatio',label:'Compressor ratio',min:1,max:12,step:0.1,unit:':1'},
 {key:'compAttack',label:'Compressor attack',min:1,max:200,step:1,unit:' ms'},
 {key:'compRelease',label:'Compressor release',min:20,max:1000,step:1,unit:' ms'},
 {key:'outputDb',label:'Master output gain',min:-20,max:20,step:0.5,unit:' dB'}
];
function fmt(v,step,unit){return (step<1?Number(v).toFixed(1):String(Math.round(Number(v))))+unit;}
function masterDSPMarkup(){
 const toggles='<div style="display:flex;gap:12px;flex-wrap:wrap;margin:4px 0 8px;color:#cbd5e1;"><label><input class="rig-master-comp" type="checkbox" '+(DSP.compOn?'checked':'')+'> Compressor</label><label><input class="rig-master-eq" type="checkbox" '+(DSP.eqOn?'checked':'')+'> EQ</label></div>';
 const sliders=DSP_CONTROLS.map(c=>'<label style="display:block;min-width:0;padding:5px 6px;background:#101827;border:1px solid #263347;border-radius:4px;color:#cbd5e1;font-size:.82em;"><span style="display:flex;justify-content:space-between;gap:5px;margin-bottom:3px;"><span>'+c.label+'</span><output data-master-param="'+c.key+'" style="color:#a5b4fc;white-space:nowrap;">'+fmt(DSP[c.key],c.step,c.unit)+'</output></span><input class="rig-master-param" data-param="'+c.key+'" type="range" min="'+c.min+'" max="'+c.max+'" step="'+c.step+'" value="'+DSP[c.key]+'" style="width:100%;margin:0;"></label>').join('');
 return '<details id="rigMasterDSP" style="margin:7px 0;border:1px solid #34304f;border-radius:5px;background:#0d111c;color:#e2e8f0;"><summary style="padding:7px;cursor:pointer;color:#c4b5fd;font-weight:800;">MASTER DSP PARAMETERS</summary><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:5px 7px;"><label style="color:#cbd5e1;"><input class="rig-master-enable" type="checkbox" '+(DSP.enabled?'checked':'')+'> Enable master DSP</label><button type="button" class="rig-master-mayer" style="padding:4px 8px;background:#312e81;color:#e0e7ff;border:1px solid #818cf8;border-radius:4px;">MAYER BLUES</button></div>'+toggles+'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:5px;padding:0 6px 7px;">'+sliders+'</div></details>';
}
function paintSnapshots(){for(let i=0;i<7;i++){const b=snapshotButton(i);if(!b)continue;const has=!!SNAPSHOTS[i],h=b.dataset.hue||'#fbbf24';b.style.color=has?'#0b0b0b':h;b.style.background=has?h:(snapshotSaveMode?'#2a1a05':'rgba(10,10,10,0.55)');b.style.borderColor=snapshotSaveMode?'#b45309':h;b.style.boxShadow=has?'0 0 8px '+h+'88':'none';b.style.opacity=has?'1':'0.75';}const b=document.querySelector('#rigSnapRow .rigSnapSave');if(b){b.style.background=snapshotSaveMode?'#b45309':'#2a1a05';b.style.color=snapshotSaveMode?'#000':'#fbbf24';}}
function paintRig(){
 NAM_KEYS.forEach(k=>{const row=document.querySelector('[data-nam8-slot="'+k+'"]');if(!row)return;row.style.opacity='1';const st=NAM[k],n=row.querySelector('.nam8-name');if(n)n.textContent=st.name||'Empty';const thumb=row.querySelector('.nam8-thumb');if(thumb){const url=st.thumbnail||'';if(url&&thumb.src!==url){thumb.src=url;}else if(!url){thumb.removeAttribute('src');}thumb.style.display=url?'block':'none';if(!thumb.dataset.errorHook){thumb.onerror=()=>{thumb.style.display='none';};thumb.dataset.errorHook='1';}}const diag=row.querySelector('.nam8-signal');if(diag){const wm=st.workletMeter;const db=v=>v==null?'—':(v>1e-7?(20*Math.log10(v)).toFixed(0)+' dB':'−∞ dB');diag.textContent=st.workletStatus+' · rig '+VERSION+(st.workletError?' · '+st.workletError:(wm?' · IN '+db(wm.inputPeak)+' / OUT '+db(wm.outputPeak)+' · '+(wm.modelRate||'?')+'/'+(wm.hostRate||'?')+' Hz · '+(wm.blockSize||'?')+' smp':''));diag.style.color=st.workletStatus==='WORKLET ERROR'||st.workletStatus==='PROCESSOR CRASH'?'#f87171':(st.workletStatus==='RUNNING'?'#86efac':'#93c5fd');}const en=row.querySelector('.nam8-enabled');if(en)en.checked=!!st.enabled;const cl=row.querySelector('.nam8-clear');if(cl)cl.style.display=st.loaded?'inline-block':'none';const tier=row.querySelector('.nam8-tier');if(tier){const subs=st.json&&st.json.architecture==='SlimmableContainer'&&st.json.config&&Array.isArray(st.json.config.submodels)?st.json.config.submodels:[],sig=subs.map(x=>String(x.max_value)+'|'+String(x.name||x.label||'')).join(';');if(tier.dataset.signature!==sig){tier.replaceChildren();const d=document.createElement('option');d.value='';d.textContent='Auto (Lite)';tier.appendChild(d);subs.forEach(sub=>{const o=document.createElement('option');o.value=String(sub.max_value);o.textContent=String(sub.name||sub.label||('Tier '+sub.max_value));tier.appendChild(o);});tier.dataset.signature=sig;}tier.style.display=subs.length>1?'inline-block':'none';tier.value=st.tier==null?'':String(st.tier);}
  const vs=row.querySelector('.nam8-model-variant');if(vs){const list=Array.isArray(st.variants)?st.variants:[],sig=list.map(m=>String(m.id)+'|'+String(m.name||'')).join(';');if(vs.dataset.signature!==sig){vs.replaceChildren();const d=document.createElement('option');d.value='';d.textContent='Model variant';vs.appendChild(d);const counts={};list.forEach(m=>{const nm=String(m.name||('Model '+m.id));counts[nm]=(counts[nm]||0)+1;});list.forEach(m=>{const o=document.createElement('option');o.value=String(m.id);const nm=String(m.name||('Model '+m.id)),size=m.size&&String(m.size)!==nm?' · '+String(m.size):'',duplicate=counts[nm]>1?' · #'+String(m.id):'';o.textContent=nm+size+duplicate;vs.appendChild(o);});vs.dataset.signature=sig;}vs.style.display=st.loaded&&st.toneId&&list.length>1?'inline-block':'none';vs.value=list.some(m=>String(m.id)===String(st.modelId))?String(st.modelId):'';}
  const fx=st.fx||SLOT_DSP_DEFAULT;row.querySelectorAll('[data-slot-param]').forEach(input=>{const key=input.dataset.slotParam;if(key in fx)input.value=String(fx[key]);});const eq=row.querySelector('.nam8-slot-eq');if(eq)eq.checked=!!fx.eqOn;
 });
 IR_KEYS.forEach(k=>{const row=document.querySelector('[data-nam8-ir="'+k+'"]');if(!row)return;const st=IR[k],n=row.querySelector('.nam8-ir-name');if(n)n.textContent=st.name||'Empty';const thumb=row.querySelector('.nam8-ir-thumb');if(thumb){const url=st.thumbnail||'';if(url&&thumb.src!==url)thumb.src=url;else if(!url)thumb.removeAttribute('src');thumb.style.display=url?'block':'none';if(!thumb.dataset.errorHook){thumb.onerror=()=>{thumb.style.display='none';};thumb.dataset.errorHook='1';}}const en=row.querySelector('.nam8-ir-enabled');if(en)en.checked=!!st.enabled;const cl=row.querySelector('.nam8-ir-clear');if(cl)cl.style.display=st.loaded?'inline-block':'none';const fx=Object.assign({},IR_FX_DEFAULT,st.fx||{});row.querySelectorAll('[data-ir-param]').forEach(input=>{const p=input.dataset.irParam;if(p in fx)input.value=String(fx[p]);});const eq=row.querySelector('.nam8-ir-eq');if(eq)eq.checked=!!fx.eqOn;});
 SIDES.forEach(side=>{const inp=el('nam8InputMode'+side);if(inp)inp.value=inputModes[side];});const hrb=el('nam8HalfRate');if(hrb)hrb.checked=false;const mdb=el('nam8Mode');if(mdb)mdb.value='dual';
 const b=el('btnRig');if(b)b.classList.toggle('active',active());
 const me=document.querySelector('.rig-master-enable');if(me)me.checked=!!DSP.enabled;const mc=document.querySelector('.rig-master-comp');if(mc)mc.checked=!!DSP.compOn;const mq=document.querySelector('.rig-master-eq');if(mq)mq.checked=!!DSP.eqOn;document.querySelectorAll('.rig-master-param').forEach(input=>{const c=DSP_CONTROLS.find(x=>x.key===input.dataset.param);if(c){input.value=String(DSP[c.key]);const out=document.querySelector('output[data-master-param="'+c.key+'"]');if(out)out.textContent=fmt(DSP[c.key],c.step,c.unit);}});
}
async function ensureWorklet(){const c=ctx||audioContext();if(!c)throw new Error('Audio engine is not ready');ctx=c;if(typeof window._namLoadModule==='function')await window._namLoadModule(c);else throw new Error('NAM audio worklet loader is unavailable');return c;}
async function ensureNode(key){if(NAM[key].node)return NAM[key].node;const c=await ensureWorklet();const st=NAM[key];const nd=new AudioWorkletNode(c,'nam-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:1,channelCountMode:'explicit',channelInterpretation:'discrete'});nd.port.onmessage=e=>{const d=e.data||{};if(d.type==='ready'){st.workletStatus='READY';st.workletError='';st.workletMeter={inputPeak:null,outputPeak:null,modelRate:d.modelRate,hostRate:d.hostRate,blockSize:d.blockSize,streamReady:false};paintRig();}else if(d.type==='processing'){st.workletStatus='PROCESSING';paintRig();}else if(d.type==='slot-meter'){st.workletMeter={inputPeak:Number(d.inputPeak)||0,outputPeak:Number(d.outputPeak)||0,modelRate:d.modelRate,hostRate:d.hostRate,blockSize:d.blockSize,streamReady:!!d.streamReady};st.workletStatus=d.streamReady?'RUNNING':'BUFFERING';paintRig();}else if(d.type==='error'){st.workletStatus='WORKLET ERROR';st.workletError=d.msg||'unknown';status(key+' NAM error: '+st.workletError);paintRig();}else if(d.type==='buffer'){status(key+' NAM buffer increased to '+d.blockSize+' samples');if(st.workletMeter)st.workletMeter.blockSize=d.blockSize;paintRig();}else if(d.type==='deadline-risk'||d.type==='overrun'){st.workletStatus='REALTIME WARNING';status('Warning: '+key+' NAM near realtime limit'+(d.blockSize?' · '+d.blockSize+'-sample blocks':'')+'; choose a lighter model tier if glitches persist');paintRig();}};nd.onprocessorerror=()=>{st.workletStatus='PROCESSOR CRASH';st.workletError='AudioWorklet processorerror event';st.compiled=false;status(key+' NAM processor crashed');paintRig();};nd.port.postMessage({type:'bypass',value:true});st.workletStatus='NODE CREATED';NAM[key].node=nd;return nd;}
function transferList(m){return m.layout.writesF.map(w=>w.data.buffer).concat(m.layout.writesI.map(w=>w.data.buffer));}
async function compileAndSend(key,json,tier){const st=NAM[key];if(!st)throw new Error('Unknown NAM slot '+key);const token=++st.compileToken,nd=await ensureNode(key);st.workletStatus='COMPILING';st.workletError='';st.workletMeter=null;paintRig();if(!window.NAMRealtime||typeof window.NAMRealtime.flattenModel!=='function')throw new Error('NAM model builder unavailable');const spec=window.NAMRealtime.flattenModel(json,tier),modelRate=24000,engineRate=Number(ctx&&ctx.sampleRate);st.rateWarning='mono NAM inference at 24000 Hz · 64-sample worklet chunks · duplicated L/R output';const emitted=window.NAMRealtime.emitChain(spec),module=await WebAssembly.compile(emitted.bytes);if(token!==st.compileToken)return false;const msg={type:'model',module,layout:emitted.layout,modelRate:24000,blockSize:64};nd.port.postMessage(msg,transferList(msg));st.compiled=true;return true;}
function setNamMode(){return route().then(paintRig).catch(err=>status(err.message));}
async function setHalfRate(on){halfRate=!!on;try{window.localStorage.setItem(HALF_KEY,halfRate?'1':'0');}catch(e){}const keys=NAM_KEYS.filter(k=>NAM[k].loaded&&NAM[k].json);status((halfRate?'Half-rate':'Full-rate')+' NAM: reloading '+keys.length+' model(s)…');try{for(const k of keys)await compileAndSend(k,NAM[k].json,NAM[k].tier);}catch(err){status('Rate change failed: '+(err&&err.message||err));paintRig();return;}paintRig();status((halfRate?'Half-rate NAM active (models run at half their sample rate: ~2x lighter, tone shifts)':'Full-rate NAM active')+' · '+keys.length+' model(s) reloaded');}
function keyAlias(key){if(NAM[key])return key;const m={pedal:'R1',amp:'R2',nam1:'R1',nam2:'R2',L1:'R5',L2:'R6',L3:'R7',L4:'R8',L5:'R1',L6:'R2',L7:'R3',L8:'R4'};return m[key]||key;}
function irAlias(key){if(IR[key])return key;const m={L:'IR1',R:'IR3','IR-L':'IR1','IR-R':'IR3',cab:'IR1',BOTH:'ALL'};return m[key]||key;}
async function setNAM(key,json,meta){
 key=keyAlias(key);meta=meta||{};if(!NAM[key])throw new Error('Unknown NAM slot '+key);if(!json||typeof json!=='object')throw new Error('NAM file is not a JSON model');
 const st=NAM[key],tier=meta.tier==null?null:meta.tier,wantsOn=meta.enabled!==false,otherOn=activeNAMKeys(key).length,willCompile=wantsOn&&otherOn<MAX_ACTIVE_NAMS;
 status('Preparing '+key+'…');
 if(willCompile){const sent=await compileAndSend(key,json,tier);if(!sent)return false;}
 else {st.compileToken++;}
 // Store inactive models without creating a live AudioWorklet/WASM instance.
 st.json=json;st.loaded=true;st.enabled=willCompile;st.tier=tier;st.name=meta.name||LABELS[key];st.toneId=meta.toneId==null?null:String(meta.toneId);st.modelId=meta.modelId==null?null:String(meta.modelId);st.modelName=meta.modelName||'';st.toneTitle=meta.toneTitle||'';st.thumbnail=meta.thumbnail||'';st.variants=Array.isArray(meta.variants)?meta.variants:[];
 if(!willCompile){st.workletStatus='LOADED / IDLE';st.workletError='';}
 await route();if(!willCompile)disposeNAMNode(key);paintRig();
 status(key+' loaded'+(willCompile&&st.rateWarning?' · '+st.rateWarning:(!willCompile?' · stored inactive; two-NAM CPU limit':'') ));return true;
}
async function setNAMEnabled(key,on){
 key=keyAlias(key);const st=NAM[key];if(!st)throw new Error('Unknown NAM slot '+key);
 if(!on){st.enabled=false;await route();disposeNAMNode(key);paintRig();return true;}
 if(!st.loaded||!st.json){st.enabled=false;status(key+' is empty — load a NAM first');paintRig();return false;}
 if(activeNAMKeys(key).length>=MAX_ACTIVE_NAMS){st.enabled=false;status('Two-NAM CPU limit: turn another NAM OFF before enabling '+key);paintRig();return false;}
 if(st.node&&!st.compiled)disposeNAMNode(key);
 if(!st.node||!st.compiled){const sent=await compileAndSend(key,st.json,st.tier);if(!sent){st.enabled=false;paintRig();return false;}st.compiled=true;}
 st.enabled=true;await route();paintRig();status(key+' enabled · '+activeNAMKeys().length+' NAMs within CPU limit');return true;
}
function disconnect(node){try{if(node)node.disconnect();}catch(e){}}
function track(node){if(node)graphNodes.add(node);return node;}
function makeDriveCurve(amount){const n=1024,a=new Float32Array(n),k=Math.max(0,Number(amount)||0)*1.1;if(k<0.001){for(let i=0;i<n;i++)a[i]=2*i/(n-1)-1;}else{const norm=Math.tanh(k);for(let i=0;i<n;i++){const x=2*i/(n-1)-1;a[i]=Math.tanh(k*x)/norm;}}return a;}
function ensureSlotFx(key){
 if(slotFx[key])return slotFx[key];
 const c=ctx,f=NAM[key].fx,pre=track(c.createGain()),drive=track(c.createWaveShaper()),low=track(c.createBiquadFilter()),bass=track(c.createBiquadFilter()),mid=track(c.createBiquadFilter()),treble=track(c.createBiquadFilter()),high=track(c.createBiquadFilter()),clipper=track(c.createWaveShaper()),dry=track(c.createGain()),wet=track(c.createGain()),mix=track(c.createGain()),post=track(c.createGain());
 let lastDrive=NaN,lastClip=NaN;drive.oversample='2x';clipper.oversample='2x';low.type='highpass';bass.type='lowshelf';mid.type='peaking';treble.type='highshelf';high.type='lowpass';low.Q.value=0.707;high.Q.value=0.707;
 function apply(){pre.gain.value=Math.pow(10,(Number(f.inputDb)||0)/20);const da=Math.max(0,Number(f.drive)||0);if(lastDrive!==da){drive.curve=makeDriveCurve(da);drive.oversample=da>0?'2x':'none';lastDrive=da;}low.frequency.value=f.lowCut;bass.frequency.value=f.bassFreq;bass.gain.value=f.eqOn?(f.bass-5)*3:0;mid.frequency.value=f.midFreq;mid.Q.value=f.midQ;mid.gain.value=f.eqOn?(f.middle-5)*3:0;treble.frequency.value=f.trebleFreq;treble.gain.value=f.eqOn?(f.treble-5)*3:0;high.frequency.value=f.highCut;const ca=Math.max(0,Number(f.clip)||0);if(lastClip!==ca){clipper.curve=makeDriveCurve(ca);clipper.oversample=ca>0?'2x':'none';lastClip=ca;}const m=Math.max(0,Math.min(100,Number(f.mix)||0))/100;dry.gain.value=1-m;wet.gain.value=m;post.gain.value=Math.pow(10,(Number(f.outputDb)||0)/20);}
 apply();slotFx[key]={pre,drive,low,bass,mid,treble,high,clipper,dry,wet,mix,post,apply};return slotFx[key];
}
function ensureIRFx(key){
 if(irFx[key])return irFx[key];
 const c=ctx,f=IR[key].fx|| (IR[key].fx=Object.assign({},IR_FX_DEFAULT)),pre=track(c.createGain()),conv=ensureIRNode(key),low=track(c.createBiquadFilter()),bass=track(c.createBiquadFilter()),mid=track(c.createBiquadFilter()),treble=track(c.createBiquadFilter()),high=track(c.createBiquadFilter()),clipper=track(c.createWaveShaper()),dry=track(c.createGain()),wet=track(c.createGain()),mix=track(c.createGain()),post=track(c.createGain());
 let lastClip=NaN;clipper.oversample='2x';low.type='highpass';bass.type='lowshelf';mid.type='peaking';treble.type='highshelf';high.type='lowpass';low.Q.value=0.707;high.Q.value=0.707;
 function apply(){pre.gain.value=Math.pow(10,(Number(f.inputDb)||0)/20);low.frequency.value=f.lowCut;bass.frequency.value=f.bassFreq;bass.gain.value=f.eqOn?(f.bass-5)*3:0;mid.frequency.value=f.midFreq;mid.Q.value=f.midQ;mid.gain.value=f.eqOn?(f.middle-5)*3:0;treble.frequency.value=f.trebleFreq;treble.gain.value=f.eqOn?(f.treble-5)*3:0;high.frequency.value=f.highCut;const ca=Math.max(0,Number(f.clip)||0);if(lastClip!==ca){clipper.curve=makeDriveCurve(ca);clipper.oversample=ca>0?'2x':'none';lastClip=ca;}const m=Math.max(0,Math.min(100,Number(f.mix)||0))/100;dry.gain.value=1-m;wet.gain.value=m;post.gain.value=Math.pow(10,(Number(f.outputDb)||0)/20);conv.buffer=IR[key].loaded&&IR[key].enabled?IR[key].buffer:null;}
 apply();irFx[key]={pre,conv,low,bass,mid,treble,high,clipper,dry,wet,mix,post,apply};return irFx[key];
}
function ensureMasterFx(){if(masterNodes.input)return masterNodes;const c=ctx;masterNodes={input:track(c.createGain()),drive:track(c.createWaveShaper()),comp:track(c.createDynamicsCompressor()),low:track(c.createBiquadFilter()),bass:track(c.createBiquadFilter()),mid:track(c.createBiquadFilter()),treble:track(c.createBiquadFilter()),high:track(c.createBiquadFilter()),output:track(c.createGain()),verbSend:track(c.createGain()),verb:track(c.createConvolver())};const m=masterNodes;m.drive.oversample='2x';m.low.type='highpass';m.bass.type='lowshelf';m.mid.type='peaking';m.treble.type='highshelf';m.high.type='lowpass';m.comp.knee.value=18;m.verb.normalize=true;const len=Math.max(1,Math.floor(c.sampleRate*1.25)),b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3);m.verb.buffer=b;return m;}
function applyMasterFx(){if(!masterNodes.input)return;const m=masterNodes,f=DSP,on=!!f.enabled;m.input.gain.value=on?Math.pow(10,f.inputDb/20):1;const driveAmount=on?Number(f.drive)||0:0;if(m._lastDrive!==driveAmount){m.drive.curve=makeDriveCurve(driveAmount);m.drive.oversample=driveAmount>0?'2x':'none';m._lastDrive=driveAmount;}m.comp.threshold.value=f.compThreshold;m.comp.ratio.value=f.compRatio;m.comp.attack.value=f.compAttack/1000;m.comp.release.value=f.compRelease/1000;m.low.frequency.value=f.lowCut;m.bass.frequency.value=f.bassFreq;m.bass.gain.value=(f.bass-5)*3;m.mid.frequency.value=f.midFreq;m.mid.Q.value=f.midQ;m.mid.gain.value=(f.middle-5)*3;m.treble.frequency.value=f.trebleFreq;m.treble.gain.value=(f.treble-5)*3;m.high.frequency.value=f.highCut;m.output.gain.value=on?Math.pow(10,f.outputDb/20):1;m.verbSend.gain.value=on?Math.min(.35,Math.max(0,f.reverb/100)):0;}
function normalizeIRBuffer(buffer){if(!buffer)return null;const c=ctx||audioContext();if(!c)return buffer;if(buffer.numberOfChannels===1)return buffer;const b=c.createBuffer(1,buffer.length,buffer.sampleRate),out=b.getChannelData(0);for(let ch=0;ch<buffer.numberOfChannels;ch++){const src=buffer.getChannelData(ch),scale=1/buffer.numberOfChannels;for(let i=0;i<src.length;i++)out[i]+=src[i]*scale;}return b;}
function ensureIRNode(key){if(!irNodes[key]){const c=ctx;irNodes[key]=track(c.createConvolver());irNodes[key].normalize=true;}irNodes[key].buffer=IR[key].loaded&&IR[key].enabled?IR[key].buffer:null;return irNodes[key];}
function clearGraph(){meterTok++;meters={};if(source)disconnect(source);for(const n of graphNodes)disconnect(n);NAM_KEYS.forEach(k=>disconnect(NAM[k].node));graphNodes=new Set();inputSplitter=null;chainInputs={};chainOutputs={};outputMerger=null;outputGain=null;masterNodes={};slotFx={};irNodes={};irFx={};}
async function routeNow(){
 const budgetDisabled=enforceNAMBudget();
 const c=ctx||audioContext();if(!c)return;ctx=c;
 if(budgetDisabled.length)status('Two-NAM CPU limit applied; kept R4 first and disabled '+budgetDisabled.join(', '));
 const src=window._namMasterNode||window._INSTVOL||null,dst=window._MASTERCLIP||(c&&c.destination);
 if(!src){status('Waiting for instrument audio source');return;}
 source=src;try{if(c.state==='suspended')await c.resume();}catch(e){}
 clearGraph();graphSrc=src;graphCtx=c;
 if(!active()){
  const comp=window._COMP_NODE;
  try{if(comp)src.connect(comp);else src.connect(dst);}catch(e){status('Dry route failed: '+e.message);}
  paintRig();return;
 }
 try{
  // NAM captures are mono. Select/sum the requested stereo input, then duplicate the
  // processed mono chain to BOTH output channels. No left-chain NAM/IR DSP exists.
  const upmix=track(c.createGain());upmix.channelCount=2;upmix.channelCountMode='explicit';upmix.channelInterpretation='speakers';src.connect(upmix);
  inputSplitter=track(c.createChannelSplitter(2));upmix.connect(inputSplitter);
  outputMerger=track(c.createChannelMerger(2));outputMerger.channelInterpretation='discrete';
  const input=track(c.createGain());chainInputs.R=input;
  const mode=inputModes.R||'both';
  if(mode==='both'){
   const l=track(c.createGain()),r=track(c.createGain());l.gain.value=0.5;r.gain.value=0.5;
   inputSplitter.connect(l,0,0);inputSplitter.connect(r,1,0);l.connect(input);r.connect(input);
  }else inputSplitter.connect(input,mode==='left'?0:1,0);
  let t=input;
  for(const key of NAM_KEYS){
   const st=NAM[key];if(!st.loaded||!st.enabled||!st.node)continue;
   const fx=ensureSlotFx(key);fx.apply();
   t.connect(fx.dry);t.connect(fx.pre);fx.pre.connect(fx.drive);fx.drive.connect(st.node);let wet=st.node;
   wet.connect(fx.low);fx.low.connect(fx.bass);fx.bass.connect(fx.mid);fx.mid.connect(fx.treble);fx.treble.connect(fx.high);wet=fx.high;
   wet.connect(fx.clipper);fx.clipper.connect(fx.wet);fx.dry.connect(fx.mix);fx.wet.connect(fx.mix);fx.mix.connect(fx.post);t=fx.post;
  }
  for(const key of IR_KEYS){
   const ir=IR[key];if(!ir.loaded||!ir.enabled||!ir.buffer)continue;
   const fx=ensureIRFx(key);fx.apply();
   t.connect(fx.dry);t.connect(fx.pre);fx.pre.connect(fx.conv);let wet=fx.conv;
   wet.connect(fx.low);fx.low.connect(fx.bass);fx.bass.connect(fx.mid);fx.mid.connect(fx.treble);fx.treble.connect(fx.high);wet=fx.high;
   wet.connect(fx.clipper);fx.clipper.connect(fx.wet);fx.dry.connect(fx.mix);fx.wet.connect(fx.mix);fx.mix.connect(fx.post);t=fx.post;
  }
  chainOutputs.R=t;
  {const an=track(c.createAnalyser());an.fftSize=512;t.connect(an);meters.R=an;}
  t.connect(outputMerger,0,0);t.connect(outputMerger,0,1);
  let finalNode=outputMerger;
  if(DSP.enabled){
   const m=ensureMasterFx();applyMasterFx();m.input.channelCount=2;m.input.channelCountMode='explicit';
   outputMerger.connect(m.input);m.input.connect(m.drive);let mt=m.drive;
   if(DSP.compOn){mt.connect(m.comp);mt=m.comp;}
   if(DSP.eqOn){mt.connect(m.low);m.low.connect(m.bass);m.bass.connect(m.mid);m.mid.connect(m.treble);mt=m.treble;}
   mt.connect(m.high);m.high.connect(m.output);const dry=track(c.createGain());dry.gain.value=1;m.output.connect(dry);m.output.connect(m.verbSend);m.verbSend.connect(m.verb);m.verb.connect(dry);finalNode=dry;
  }
  finalNode.connect(dst);
  {const mt=++meterTok;(function poll(){if(mt!==meterTok)return;let txt='';const an=meters.R;if(an){const d=new Float32Array(an.fftSize);an.getFloatTimeDomainData(d);let p=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>p)p=a;}txt='R '+(p>=1e-4?(20*Math.log10(p)).toFixed(0)+' dB':'silent');}let n=el('nam8Meter');if(!n){const sn=el('nam8Status');if(sn&&sn.parentNode){n=document.createElement('div');n.id='nam8Meter';n.style.cssText='color:#a7f3d0;font-size:.9em;margin-top:2px;';sn.parentNode.insertBefore(n,sn.nextSibling);}}if(n)n.textContent='Serial chain level: '+txt+' · stereo out';setTimeout(poll,500);})();}
  status('Single serial chain active · '+NAM_KEYS.filter(k=>NAM[k].loaded&&NAM[k].enabled).length+'/8 NAM · '+IR_KEYS.filter(k=>IR[k].loaded&&IR[k].enabled&&IR[k].buffer).length+'/4 IR · stereo out');
 }catch(err){clearGraph();try{if(window._COMP_NODE)src.connect(window._COMP_NODE);else src.connect(dst);}catch(e){}status('Rig routing failed; dry audio restored: '+(err&&err.message||err));throw err;}
 paintRig();
}
function route(){routeQueue=routeQueue.catch(()=>{}).then(routeNow).catch(err=>{status('Stereo rig routing failed: '+(err&&err.message||err));throw err;});return routeQueue;}
async function setIR(key,buffer,meta){key=irAlias(key);meta=meta||{};if(key==='ALL'||key==='BOTH'){for(const k of IR_KEYS){IR[k].buffer=normalizeIRBuffer(buffer);IR[k].loaded=!!buffer;IR[k].enabled=meta.enabled!==false;if(!IR[k].fx)IR[k].fx=Object.assign({},IR_FX_DEFAULT);IR[k].name=buffer?(meta.name||k):'Empty';IR[k].toneId=meta.toneId==null?null:String(meta.toneId);IR[k].modelId=meta.modelId==null?null:String(meta.modelId);IR[k].modelName=meta.modelName||'';IR[k].toneTitle=meta.toneTitle||'';IR[k].thumbnail=meta.thumbnail||'';}await route();paintRig();return;}if(!IR[key])throw new Error('Unknown IR slot '+key);IR[key].buffer=normalizeIRBuffer(buffer);IR[key].loaded=!!buffer;IR[key].enabled=meta.enabled!==false;if(!IR[key].fx)IR[key].fx=Object.assign({},IR_FX_DEFAULT);IR[key].name=buffer?(meta.name||key):'Empty';IR[key].toneId=meta.toneId==null?null:String(meta.toneId);IR[key].modelId=meta.modelId==null?null:String(meta.modelId);IR[key].modelName=meta.modelName||'';IR[key].toneTitle=meta.toneTitle||'';IR[key].thumbnail=meta.thumbnail||'';await route();paintRig();}
async function clearNAM(key){key=keyAlias(key);if(!NAM[key])throw new Error('Unknown NAM slot '+key);const st=NAM[key];st.compileToken++;st.json=null;st.loaded=false;st.enabled=false;st.compiled=false;st.tier=null;st.name='Empty';st.toneId=null;st.modelId=null;st.modelName='';st.toneTitle='';st.thumbnail='';st.variants=[];st.rateWarning='';st.workletStatus='not created';st.workletError='';st.workletMeter=null;await route();disposeNAMNode(key);paintRig();}
async function clearIR(key){if(!key||key==='ALL'){for(const k of IR_KEYS)IR[k]=EMPTY_IR();}else{key=irAlias(key);if(!IR[key])throw new Error('Unknown IR slot '+key);IR[key]=EMPTY_IR();}await route();paintRig();}
function serializeIR(buf){if(!buf)return null;const chans=[];for(let c=0;c<buf.numberOfChannels;c++)chans.push(new Float32Array(buf.getChannelData(c)));return {sampleRate:buf.sampleRate,length:buf.length,chans};}
function deserializeIR(o){if(!o||!o.chans||!o.chans.length)return null;const c=ctx||audioContext();if(!c)return null;const b=c.createBuffer(o.chans.length,o.length,o.sampleRate);o.chans.forEach((x,i)=>b.getChannelData(i).set(x));return normalizeIRBuffer(b);}
function migrateSnapshot(old){
 if(!old)return null;
 const modes=old.inputModes&&typeof old.inputModes==='object'?{L:old.inputModes.L||'left',R:old.inputModes.R||'right'}:{L:(['both','left','right'].includes(old.inputMode)?old.inputMode:inputModes.L),R:(['both','left','right'].includes(old.inputMode)?old.inputMode:inputModes.R)};
 const n={schemaVersion:4,slots:{},ir:{},inputModes:modes,dsp:Object.assign({},DSP_DEFAULT,old.dsp&&old.dsp.enabled!==undefined?old.dsp:(old.dsp&&old.dsp.L)||{})};
 NAM_KEYS.forEach(k=>n.slots[k]={json:null,loaded:false,enabled:false,tier:null,name:'Empty',fx:Object.assign({},SLOT_DSP_DEFAULT)});IR_KEYS.forEach(k=>n.ir[k]={loaded:false,enabled:true,serialized:null,name:'Empty',fx:Object.assign({},IR_FX_DEFAULT)});
 const oldSlots=old.slots||{};
 if(Number(old.schemaVersion)>=4){
  for(const k of NAM_KEYS){const src=oldSlots[k];if(src)n.slots[k]=Object.assign({},n.slots[k],src,{fx:Object.assign({},SLOT_DSP_DEFAULT,src.fx||{})});}
  // Build 924 dual-chain snapshots: preserve visible R1–R4, append former L1–L4 as R5–R8.
  for(let i=1;i<=4;i++){const dst='R'+(i+4),src=oldSlots['L'+i];if(!oldSlots[dst]&&src)n.slots[dst]=Object.assign({},n.slots[dst],src,{fx:Object.assign({},SLOT_DSP_DEFAULT,src.fx||{})});}
 }else{
  // Older serial-chain snapshots used L1–L8; convert their order into R1–R8.
  for(let i=1;i<=8;i++){const src=oldSlots['L'+i]||oldSlots['R'+i]||{};if(src.json||src.loaded)n.slots['R'+i]=Object.assign({},n.slots['R'+i],src,{fx:Object.assign({},SLOT_DSP_DEFAULT,src.fx||{})});}
 }
 for(let i=0;i<4;i++){const k=IR_KEYS[i],src=(old.ir&&old.ir[k])||(i===0&&old.ir&&old.ir.L)||(i===2&&old.ir&&old.ir.R)||{};n.ir[k]=Object.assign({},n.ir[k],src,{serialized:src.serialized||null,buffer:src.buffer||null,fx:Object.assign({},IR_FX_DEFAULT,src.fx||{})});}
 // Older pedal/amp/cab snapshots remain recallable.
 if(!old.slots&&(old.pedal||old.amp)){const copyLegacy=(src,key,on)=>{if(!src)return;n.slots[key]=Object.assign({},n.slots[key],{json:src.json||null,loaded:!!(src.loaded&&src.json),enabled:on!==false&&!!(src.loaded&&src.json),tier:src.tier==null?null:src.tier,name:src.name||src.modelName||LABELS[key],toneId:src.toneId||null,modelId:src.modelId||null,modelName:src.modelName||'',toneTitle:src.toneTitle||'',variants:src.variants||[],fx:Object.assign({},SLOT_DSP_DEFAULT)});};copyLegacy(old.pedal,'R1',old.on?old.on.pedal:true);copyLegacy(old.amp,'R2',old.on?old.on.amp:true);const cab=old.cab||{};const savedIR=cab.ir||null;if(savedIR||cab.loaded)n.ir.IR1={loaded:!!cab.loaded,enabled:!old.on||old.on.ir!==false,serialized:savedIR,buffer:cab.buf||null,name:cab.name||'Legacy IR',fx:Object.assign({},IR_FX_DEFAULT)};}
 return n;
}
function capture(){const slots={};NAM_KEYS.forEach(k=>{const s=NAM[k];slots[k]={json:s.json,loaded:s.loaded,enabled:s.enabled,tier:s.tier,name:s.name,toneId:s.toneId,modelId:s.modelId,modelName:s.modelName,toneTitle:s.toneTitle,variants:s.variants||[],thumbnail:s.thumbnail||'',fx:Object.assign({},SLOT_DSP_DEFAULT,s.fx||{})};});const ir={};IR_KEYS.forEach(k=>{const s=IR[k];ir[k]={loaded:s.loaded,enabled:s.enabled,buffer:null,serialized:serializeIR(s.buffer),name:s.name,thumbnail:s.thumbnail||'',toneId:s.toneId,modelId:s.modelId,modelName:s.modelName,toneTitle:s.toneTitle,fx:Object.assign({},IR_FX_DEFAULT,s.fx||{})};});return {schemaVersion:4,slots,ir,inputModes:Object.assign({},inputModes),dsp:Object.assign({},DSP)};}
function snapshotForDisk(s){const n=migrateSnapshot(s||capture());if(!n)return null;const o={schemaVersion:4,slots:{},ir:{},inputModes:Object.assign({},n.inputModes),dsp:Object.assign({},DSP_DEFAULT,n.dsp||{})};NAM_KEYS.forEach(k=>o.slots[k]=Object.assign({},n.slots[k]||{}, {fx:Object.assign({},SLOT_DSP_DEFAULT,n.slots[k]&&n.slots[k].fx||{})}));IR_KEYS.forEach(k=>{const ir=n.ir[k]||{};o.ir[k]={loaded:!!ir.loaded,enabled:ir.enabled!==false,serialized:ir.serialized||serializeIR(ir.buffer||null),name:ir.name||'Empty',thumbnail:ir.thumbnail||'',toneId:ir.toneId||null,modelId:ir.modelId||null,modelName:ir.modelName||'',toneTitle:ir.toneTitle||'',fx:Object.assign({},IR_FX_DEFAULT,ir.fx||{})};});return o;}
async function hydrateMissingThumbnails(){
 if(!window.T3K||!T3K.connected||!T3K.connected()||typeof T3K.getTone!=='function')return;
 const targets=[];
 NAM_KEYS.forEach(k=>{const s=NAM[k];if(s.loaded&&s.toneId&&!s.thumbnail)targets.push({state:s,id:s.toneId});});
 IR_KEYS.forEach(k=>{const s=IR[k];if(s.loaded&&s.toneId&&!s.thumbnail)targets.push({state:s,id:s.toneId});});
 await Promise.all(targets.map(async item=>{try{const raw=await T3K.getTone(item.id),tone=raw&&(raw.data||raw),thumb=toneThumbnail(tone,null);if(thumb){item.state.thumbnail=thumb;if(!item.state.toneTitle)item.state.toneTitle=tone.title||tone.name||'';}}catch(e){console.warn('[T3K] saved tone thumbnail unavailable',item.id,e);}}));
 paintRig();
}
async function restoreSnapshot(raw){const snap=migrateSnapshot(raw);if(!snap)throw new Error('Empty snapshot');await ensureWorklet();for(const side of SIDES){inputModes[side]=['both','left','right'].includes(snap.inputModes[side])?snap.inputModes[side]:(side==='L'?'left':'right');try{window.localStorage.setItem(INPUT_MODE_KEY+'.'+side,inputModes[side]);}catch(e){}}Object.assign(DSP,DSP_DEFAULT,snap.dsp||{});const jobs=[];for(const key of NAM_KEYS){const s=snap.slots[key]||{},st=NAM[key];Object.assign(st,{json:s.json||null,loaded:!!(s.loaded&&s.json),enabled:s.enabled!==false,tier:s.tier==null?null:s.tier,name:s.name||'Empty',toneId:s.toneId||null,modelId:s.modelId||null,modelName:s.modelName||'',toneTitle:s.toneTitle||'',variants:s.variants||[],thumbnail:s.thumbnail||'',fx:Object.assign({},SLOT_DSP_DEFAULT,s.fx||{})});st.compileToken++;st.compiled=false;}
 // Old snapshots may contain eight enabled models. Preserve R4 first, then cap to two.
 const snapshotOn=NAM_KEYS.filter(k=>NAM[k].loaded&&NAM[k].enabled),snapshotOrder=snapshotOn.includes('R4')?['R4',...snapshotOn.filter(k=>k!=='R4')]:snapshotOn,keepOn=new Set(snapshotOrder.slice(0,MAX_ACTIVE_NAMS));for(const key of snapshotOn)if(!keepOn.has(key))NAM[key].enabled=false;
 for(const key of NAM_KEYS){const st=NAM[key];if(st.loaded&&st.enabled)jobs.push({key,json:st.json,tier:st.tier});}for(const key of IR_KEYS){const ir=snap.ir[key]||{};let buf=ir.buffer||null;if(!buf&&ir.serialized)buf=deserializeIR(ir.serialized);IR[key]=Object.assign(EMPTY_IR(),{loaded:!!(ir.loaded&&buf),enabled:ir.enabled!==false,buffer:normalizeIRBuffer(buf),name:ir.name||'Empty',thumbnail:ir.thumbnail||'',toneId:ir.toneId||null,modelId:ir.modelId||null,modelName:ir.modelName||'',toneTitle:ir.toneTitle||'',fx:Object.assign({},IR_FX_DEFAULT,ir.fx||{})});}for(const job of jobs)await compileAndSend(job.key,job.json,job.tier);await route();for(const key of NAM_KEYS)if(!NAM[key].loaded||!NAM[key].enabled)disposeNAMNode(key);paintRig();hydrateMissingThumbnails().catch(e=>console.warn('[T3K] thumbnail hydration failed',e));}
async function persistSnapshot(i){const d=snapshotForDisk(SNAPSHOTS[i]),tasks=[];try{if(window.SampleStore){if(d&&window.SampleStore.saveSnap)tasks.push(Promise.resolve(window.SampleStore.saveSnap(i,d)));else if(!d&&window.SampleStore.delSnap)tasks.push(Promise.resolve(window.SampleStore.delSnap(i)));}}catch(e){}try{if(window.RigSnapStore){if(d&&window.RigSnapStore.save)tasks.push(Promise.resolve(window.RigSnapStore.save(i,d)));else if(!d&&window.RigSnapStore.drop)tasks.push(Promise.resolve(window.RigSnapStore.drop(i)));}}catch(e){}await Promise.all(tasks);}
async function loadSnapshots(){for(let i=0;i<7;i++){let d=null;try{if(window.SampleStore&&window.SampleStore.loadSnap)d=await window.SampleStore.loadSnap(i);}catch(e){}try{if(!d&&window.RigSnapStore&&window.RigSnapStore.load)d=await window.RigSnapStore.load(i);}catch(e){}if(d)SNAPSHOTS[i]=migrateSnapshot(d);}paintSnapshots();}
async function saveSnapshot(i){if(i<0||i>6)throw new Error('Snapshot index must be 0–6');SNAPSHOTS[i]=capture();await persistSnapshot(i);paintSnapshots();return SNAPSHOTS[i];}
async function recallSnapshot(i){const sn=SNAPSHOTS[i];if(!sn){const stat=el('rigSnapStat');if(stat)stat.textContent='Slot '+('ABCDEFG'[i]||i)+' is empty';return;}await restoreSnapshot(sn);const stat=el('rigSnapStat');if(stat){stat.textContent='ABCDEFG'[i]+' ✓';setTimeout(()=>{if(stat.textContent==='ABCDEFG'[i]+' ✓')stat.textContent='';},1600);}}
async function loadNAMFile(file,key){if(!file)return;let text;if(/\.zip$/i.test(file.name))text=await extractNAMZip(file);else text=await file.text();await setNAM(key,JSON.parse(text),{name:file.name,enabled:true});}
async function extractNAMZip(file){const buf=await file.arrayBuffer(),dv=new DataView(buf),u8=new Uint8Array(buf);let eocd=-1;for(let i=buf.byteLength-22;i>=Math.max(0,buf.byteLength-65558);i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}if(eocd<0)throw new Error('Not a ZIP file');const count=dv.getUint16(eocd+10,true);let p=dv.getUint32(eocd+16,true);for(let e=0;e<count;e++){if(dv.getUint32(p,true)!==0x02014b50)throw new Error('Invalid ZIP central directory');const method=dv.getUint16(p+10,true),size=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),off=dv.getUint32(p+42,true),name=new TextDecoder().decode(u8.subarray(p+46,p+46+nl));if(/\.(nam|json)$/i.test(name)){const localName=dv.getUint16(off+26,true),localExtra=dv.getUint16(off+28,true),start=off+30+localName+localExtra,compressed=u8.subarray(start,start+size);if(method===0)return new TextDecoder().decode(compressed);if(method===8&&window.DecompressionStream){const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new TextDecoder().decode(await new Response(stream).arrayBuffer());}throw new Error('Unsupported ZIP compression method '+method);}p+=46+nl+el+cl;}throw new Error('ZIP contains no .nam or .json model');}
function applyMayerPreset(){Object.assign(DSP,{enabled:true,compOn:true,eqOn:true,inputDb:0,drive:0,lowCut:70,bassFreq:120,bass:5,midFreq:750,midQ:0.8,middle:5.6,trebleFreq:3000,treble:4.7,highCut:12000,reverb:8,compThreshold:-24,compRatio:3,compAttack:20,compRelease:150,outputDb:0});route().then(paintRig).catch(e=>status('Preset route failed: '+e.message));paintRig();}
function buildUI(){
 const panel=el('rigPanel');if(!panel||el('rig8Layout'))return;const snapRow=el('rigSnapRow');panel.querySelectorAll('.rigSlot,.rigFxPanel').forEach(n=>n.remove());
 const layout=document.createElement('div');layout.id='rig8Layout';layout.innerHTML='<div style="font-size:1.08em;font-weight:900;color:#fbbf24;margin:1px 0 4px;">8× NAM → 4× IR · SINGLE SERIAL CHAIN · STEREO OUT</div><div style="font-size:.92em;color:#b7bfd0;margin-bottom:5px;">R1–R8 run in series, followed by IR1–IR4 in series. The processed signal feeds both stereo output channels. Host sample rate and buffer configuration are unchanged.</div><div class="nam8-grid" style="display:grid;grid-template-columns:minmax(0,1fr);gap:8px;"></div>'+masterDSPMarkup()+'<input id="nam8File" type="file" accept=".nam,.zip,application/json,application/zip" style="display:none"><input id="nam8IRFile" type="file" accept=".wav,audio/wav,audio/*" style="display:none"><div id="nam8Status" style="color:#7dd3fc;font-size:.9em;min-height:1em;margin-top:3px;"></div>';
 const grid=layout.querySelector('.nam8-grid');
 function slotRow(key,side){
  const row=document.createElement('div');row.setAttribute('data-nam8-slot',key);row.style.cssText='display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:6px;background:#0b0f18;border-radius:5px;border:1px solid #273244;';
  row.innerHTML='<strong style="width:32px;color:#f9a8d4;">'+key+'</strong><img class="nam8-thumb" alt="" style="display:none;width:42px;height:42px;object-fit:cover;border-radius:5px;border:1px solid #374151;background:#111827;flex:0 0 42px;"><label style="display:flex;align-items:center;gap:3px;color:#cbd5e1;"><input class="nam8-enabled" type="checkbox"> ON</label><button type="button" class="nam8-file">FILE</button><button type="button" class="nam8-t3k">T3K</button><button type="button" class="nam8-clear" style="display:none;color:#f87171;">×</button><select class="nam8-tier" style="display:none;max-width:115px;background:#101827;color:#e2e8f0;"><option value="">Auto (Lite)</option></select><select class="nam8-model-variant" style="display:none;max-width:150px;background:#101827;color:#e2e8f0;"><option value="">Model variant</option></select><span class="nam8-name" style="color:#e2e8f0;flex:1 1 100%;min-width:0;overflow-wrap:anywhere;">Empty</span><small class="nam8-signal" style="flex:1 1 100%;font:11px/1.35 monospace;color:#93c5fd;overflow-wrap:anywhere;">NOT CREATED</small><details style="flex:1 1 100%;margin-top:3px;color:#cbd5e1;"><summary style="cursor:pointer;color:#a5b4fc;">SLOT PARAMETERS · '+key+'</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:6px;padding:5px 0;"><label>Input dB <input data-slot-key="'+key+'" data-slot-param="inputDb" type="range" min="-18" max="18" step="0.5" value="0"></label><label>Drive <input data-slot-key="'+key+'" data-slot-param="drive" type="range" min="0" max="10" step="0.1" value="0"></label><label>Output dB <input data-slot-key="'+key+'" data-slot-param="outputDb" type="range" min="-18" max="18" step="0.5" value="0"></label><label>Mix % <input data-slot-key="'+key+'" data-slot-param="mix" type="range" min="0" max="100" step="1" value="100"></label><label>Clip <input data-slot-key="'+key+'" data-slot-param="clip" type="range" min="0" max="10" step="0.1" value="0"></label><label><input class="nam8-slot-eq" data-slot-key="'+key+'" type="checkbox"> EQ ON</label><label>Low cut <input data-slot-key="'+key+'" data-slot-param="lowCut" type="range" min="20" max="500" step="1" value="70"></label><label>Bass Hz <input data-slot-key="'+key+'" data-slot-param="bassFreq" type="range" min="40" max="500" step="1" value="120"></label><label>Bass <input data-slot-key="'+key+'" data-slot-param="bass" type="range" min="0" max="10" step="0.1" value="5"></label><label>Mid Hz <input data-slot-key="'+key+'" data-slot-param="midFreq" type="range" min="100" max="8000" step="10" value="750"></label><label>Mid Q <input data-slot-key="'+key+'" data-slot-param="midQ" type="range" min="0.3" max="5" step="0.1" value="0.8"></label><label>Mids <input data-slot-key="'+key+'" data-slot-param="middle" type="range" min="0" max="10" step="0.1" value="5"></label><label>Treble Hz <input data-slot-key="'+key+'" data-slot-param="trebleFreq" type="range" min="1000" max="12000" step="10" value="3000"></label><label>Treble <input data-slot-key="'+key+'" data-slot-param="treble" type="range" min="0" max="10" step="0.1" value="5"></label><label>High cut <input data-slot-key="'+key+'" data-slot-param="highCut" type="range" min="1000" max="20000" step="100" value="12000"></label></div></details>';
  return row;
 }
 function irRow(key,side){
  const row=document.createElement('div');row.dataset.nam8Ir=key;row.style.cssText='display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:6px;background:#0b0f18;border-radius:5px;border:1px solid #273244;';
  row.innerHTML='<strong style="width:35px;color:#5eead4;">'+key+'</strong><img class="nam8-ir-thumb" alt="" style="display:none;width:42px;height:42px;object-fit:cover;border-radius:5px;border:1px solid #374151;background:#111827;flex:0 0 42px;"><label style="color:#cbd5e1;"><input class="nam8-ir-enabled" type="checkbox" checked> ON</label><button type="button" class="nam8-ir-file">LOAD IR</button><button type="button" class="nam8-ir-t3k">T3K</button><button type="button" class="nam8-ir-clear" style="display:none;color:#f87171;">CLEAR</button><span class="nam8-ir-name" style="color:#e2e8f0;flex:1;min-width:75px;overflow-wrap:anywhere;">Empty</span><details style="flex:1 1 100%;color:#cbd5e1;"><summary style="cursor:pointer;color:#5eead4;">IR PARAMETERS · '+key+'</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:6px;padding:5px 0;"><label>Input dB <input data-ir-key="'+key+'" data-ir-param="inputDb" type="range" min="-18" max="18" step="0.5" value="0"></label><label>Output dB <input data-ir-key="'+key+'" data-ir-param="outputDb" type="range" min="-18" max="18" step="0.5" value="0"></label><label>Mix % <input data-ir-key="'+key+'" data-ir-param="mix" type="range" min="0" max="100" step="1" value="100"></label><label>Clip <input data-ir-key="'+key+'" data-ir-param="clip" type="range" min="0" max="10" step="0.1" value="0"></label><label><input class="nam8-ir-eq" data-ir-key="'+key+'" type="checkbox"> EQ ON</label><label>Low cut <input data-ir-key="'+key+'" data-ir-param="lowCut" type="range" min="20" max="500" step="1" value="70"></label><label>Bass Hz <input data-ir-key="'+key+'" data-ir-param="bassFreq" type="range" min="40" max="500" step="1" value="120"></label><label>Bass <input data-ir-key="'+key+'" data-ir-param="bass" type="range" min="0" max="10" step="0.1" value="5"></label><label>Mid Hz <input data-ir-key="'+key+'" data-ir-param="midFreq" type="range" min="100" max="8000" step="10" value="750"></label><label>Mid Q <input data-ir-key="'+key+'" data-ir-param="midQ" type="range" min="0.3" max="5" step="0.1" value="0.8"></label><label>Mids <input data-ir-key="'+key+'" data-ir-param="middle" type="range" min="0" max="10" step="0.1" value="5"></label><label>Treble Hz <input data-ir-key="'+key+'" data-ir-param="trebleFreq" type="range" min="1000" max="12000" step="10" value="3000"></label><label>Treble <input data-ir-key="'+key+'" data-ir-param="treble" type="range" min="0" max="10" step="0.1" value="5"></label><label>High cut <input data-ir-key="'+key+'" data-ir-param="highCut" type="range" min="1000" max="20000" step="100" value="12000"></label></div></details>';
  return row;
 }
 {
  const side='R';
  const section=document.createElement('section');section.style.cssText='background:#101521;border:1px solid #be185d;border-radius:7px;padding:7px;min-width:0;';
  section.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:7px;"><strong style="color:#f9a8d4;font-size:1.08em;">RIGHT OUTPUT CHAIN · R1–R8</strong><label style="display:flex;align-items:center;gap:4px;color:#cbd5e1;">INPUT <select id="nam8InputModeR" data-input-side="R" style="background:#101827;color:#e2e8f0;border:1px solid #475569;border-radius:5px;padding:5px;"><option value="both">L+R (mono sum)</option><option value="left">L only</option><option value="right">R only</option></select></label></div><div class="nam8-slots" style="display:flex;flex-direction:column;gap:6px;"></div><div style="margin-top:8px;border-top:1px dashed #64748b;padding-top:7px;"><strong style="color:#5eead4;display:block;margin-bottom:5px;">IR SLOTS · IR1–IR4 (SERIES)</strong><div class="nam8-irs" style="display:flex;flex-direction:column;gap:6px;"></div></div>';
  const slots=section.querySelector('.nam8-slots');sideKeys(side).forEach(key=>slots.appendChild(slotRow(key,side)));
  const irs=section.querySelector('.nam8-irs');IR_KEYS.forEach(key=>irs.appendChild(irRow(key,side)));
  grid.appendChild(section);
 }
 layout.querySelectorAll('button').forEach(b=>{b.style.cssText+='padding:4px 7px;border-radius:4px;border:1px solid #475569;background:#172033;color:#e2e8f0;';if(b.classList.contains('nam8-file')){b.style.background='#1f1235';b.style.color='#c4b5fd';}if(b.classList.contains('nam8-t3k')||b.classList.contains('nam8-ir-t3k')){b.style.background='#0c2740';b.style.color='#7dd3fc';}if(b.classList.contains('nam8-ir-file')){b.style.background='#12302b';b.style.color='#5eead4';}});
 if(snapRow){const oldSave=snapRow.querySelector('.rigSnapSave');if(oldSave){const b=oldSave.cloneNode(false);b.textContent='SAVE';oldSave.replaceWith(b);}snapRow.querySelectorAll('.rigSnap').forEach(old=>old.replaceWith(old.cloneNode(false)));}panel.insertBefore(layout,snapRow||panel.lastChild);
 const namFile=el('nam8File'),irFile=el('nam8IRFile');
 layout.addEventListener('click',e=>{e.stopPropagation();const t=e.target.closest('button');if(!t)return;const row=t.closest('[data-nam8-slot]'),key=row&&row.dataset.nam8Slot,irrow=t.closest('[data-nam8-ir]'),irk=irrow&&irrow.dataset.nam8Ir;if(t.classList.contains('rig-master-mayer'))applyMayerPreset();else if(t.classList.contains('nam8-file')){fileTarget=key;namFile.value='';namFile.click();}else if(t.classList.contains('nam8-t3k'))openT3K(key,'nam');else if(t.classList.contains('nam8-clear'))clearNAM(key).catch(err=>status(err.message));else if(t.classList.contains('nam8-ir-file')){fileTarget=irk;irFile.value='';irFile.click();}else if(t.classList.contains('nam8-ir-t3k'))openT3K(irk,'ir');else if(t.classList.contains('nam8-ir-clear'))clearIR(irk).catch(err=>status(err.message));});
 layout.addEventListener('change',e=>{const t=e.target;if(t.id==='nam8HalfRate'||t.id==='nam8Mode')return;if(t.matches('select[data-input-side]')){const side=t.dataset.inputSide;inputModes[side]=['both','left','right'].includes(t.value)?t.value:(side==='L'?'left':'right');try{window.localStorage.setItem(INPUT_MODE_KEY+'.'+side,inputModes[side]);}catch(err){}route().catch(err=>status(err.message));}else if(t.classList.contains('nam8-enabled')){const row=t.closest('[data-nam8-slot]');if(row){setNAMEnabled(row.dataset.nam8Slot,t.checked).catch(err=>status(err.message));}}else if(t.classList.contains('nam8-ir-enabled')){const row=t.closest('[data-nam8-ir]');if(row){IR[row.dataset.nam8Ir].enabled=t.checked;route().then(paintRig).catch(err=>status(err.message));}}else if(t.classList.contains('nam8-slot-eq')){const k=t.dataset.slotKey;NAM[k].fx.eqOn=t.checked;route().then(paintRig).catch(err=>status(err.message));}else if(t.classList.contains('nam8-ir-eq')){const k=t.dataset.irKey;IR[k].fx.eqOn=t.checked;route().then(paintRig).catch(err=>status(err.message));}else if(t.classList.contains('nam8-tier')){const row=t.closest('[data-nam8-slot]');if(row){const key=row.dataset.nam8Slot,tier=t.value===''?null:Number(t.value),st=NAM[key];if(st.json)setNAM(key,st.json,{name:st.name,tier,enabled:st.enabled,toneId:st.toneId,modelId:st.modelId,modelName:st.modelName,toneTitle:st.toneTitle,thumbnail:st.thumbnail,variants:st.variants}).catch(err=>status(err.message));}}else if(t.classList.contains('nam8-model-variant')){const row=t.closest('[data-nam8-slot]');if(row){const key=row.dataset.nam8Slot,m=(NAM[key].variants||[]).find(x=>String(x.id)===String(t.value));if(m&&String(m.id)!==String(NAM[key].modelId))switchNAMVariant(key,m);}}else if(t.classList.contains('rig-master-enable')){DSP.enabled=t.checked;route().catch(err=>status(err.message));}else if(t.classList.contains('rig-master-comp')){DSP.compOn=t.checked;if(t.checked)DSP.enabled=true;route().catch(err=>status(err.message));}else if(t.classList.contains('rig-master-eq')){DSP.eqOn=t.checked;if(t.checked)DSP.enabled=true;route().catch(err=>status(err.message));}});
 layout.addEventListener('input',e=>{const t=e.target;const eqParams=['bassFreq','bass','midFreq','midQ','middle','trebleFreq','treble'];if(t.matches('[data-slot-param]')){const k=t.dataset.slotKey,p=t.dataset.slotParam;if(NAM[k]&&NAM[k].fx&&p in NAM[k].fx){NAM[k].fx[p]=Number(t.value);if(eqParams.includes(p)){NAM[k].fx.eqOn=true;const row=t.closest('[data-nam8-slot]'),eq=row&&row.querySelector('.nam8-slot-eq');if(eq)eq.checked=true;}const fx=slotFx[k];if(fx)fx.apply();else if(NAM[k].loaded)route().catch(err=>status(err.message));}}else if(t.matches('[data-ir-param]')){const k=t.dataset.irKey,p=t.dataset.irParam;if(IR[k]&&IR[k].fx&&p in IR[k].fx){IR[k].fx[p]=Number(t.value);if(eqParams.includes(p)){IR[k].fx.eqOn=true;const row=t.closest('[data-nam8-ir]'),eq=row&&row.querySelector('.nam8-ir-eq');if(eq)eq.checked=true;}const fx=irFx[k];if(fx)fx.apply();else if(IR[k].loaded)route().catch(err=>status(err.message));}}else if(t.classList.contains('rig-master-param')){const c=DSP_CONTROLS.find(x=>x.key===t.dataset.param);if(c){DSP[c.key]=Number(t.value);applyMasterFx();const out=layout.querySelector('output[data-master-param="'+c.key+'"]');if(out)out.textContent=fmt(DSP[c.key],c.step,c.unit);}}});
 namFile.addEventListener('change',async()=>{const f=namFile.files&&namFile.files[0];if(!f||!fileTarget)return;const k=fileTarget;fileTarget=null;try{status('Loading '+k+'…');await loadNAMFile(f,k);}catch(e){status(k+' load failed: '+(e.message||e));}});
 irFile.addEventListener('change',async()=>{const f=irFile.files&&irFile.files[0];if(!f||!fileTarget)return;const k=fileTarget;fileTarget=null;try{status('Loading '+k+'…');const c=audioContext();if(!c)throw new Error('Audio engine not ready');const b=await c.decodeAudioData(await f.arrayBuffer());await setIR(k,b,{name:f.name,enabled:true});status(k+' loaded');}catch(e){status(k+' load failed: '+(e.message||e));}});
 const rowSave=snapRow&&snapRow.querySelector('.rigSnapSave');if(rowSave)rowSave.addEventListener('click',e=>{e.stopPropagation();snapshotSaveMode=!snapshotSaveMode;const st=el('rigSnapStat');if(st)st.textContent=snapshotSaveMode?'Tap A–G to save current rig':'';paintSnapshots();});if(snapRow)snapRow.querySelectorAll('.rigSnap').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const i=Number(b.dataset.snap);if(snapshotSaveMode){SNAPSHOTS[i]=capture();snapshotSaveMode=false;persistSnapshot(i).then(()=>{const st=el('rigSnapStat');if(st)st.textContent='Saved '+('ABCDEFG'[i]);}).catch(err=>status('Snapshot save failed: '+err.message));paintSnapshots();}else recallSnapshot(i).catch(err=>status('Snapshot recall failed: '+err.message));}));paintSnapshots();paintRig();
}
function openT3K(target,format){if(window.__openLegacyT3KForNAM8){window.__openLegacyT3KForNAM8(target,format);return;}t3kTarget={target,format};let modal=el('nam8T3KModal');if(!modal){modal=document.createElement('div');modal.id='nam8T3KModal';modal.style.cssText='position:fixed;inset:0;z-index:10020;background:rgba(3,7,18,.94);display:none;flex-direction:column;padding:18px;gap:9px;color:#e2e8f0;font:14px system-ui,sans-serif;';modal.innerHTML='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><strong style="font-size:18px;color:#7dd3fc;">TONE3000 · NAM / IR</strong><span id="nam8T3KTarget" style="flex:1;color:#a5b4fc;"></span><button id="nam8T3KClose" type="button">CLOSE</button></div><div style="display:flex;gap:6px;flex-wrap:wrap;"><input id="nam8T3KQuery" placeholder="Search tones…" style="flex:1;min-width:140px;padding:8px;background:#111827;color:#fff;border:1px solid #475569;border-radius:5px;"><select id="nam8T3KGear" style="padding:7px;background:#111827;color:#fff;"><option value="amp">Amp</option><option value="pedal">Pedal</option><option value="amp-cab">Amp + Cab</option><option value="cab">Cab / IR</option></select><button id="nam8T3KConnect" type="button">CONNECT</button><button id="nam8T3KSearch" type="button">SEARCH</button></div><div id="nam8T3KResults" style="flex:1;overflow:auto;border:1px solid #334155;border-radius:6px;"></div>';document.body.appendChild(modal);el('nam8T3KClose').onclick=()=>modal.style.display='none';el('nam8T3KSearch').onclick=()=>searchT3K();el('nam8T3KQuery').addEventListener('keydown',e=>{if(e.key==='Enter')searchT3K();});el('nam8T3KConnect').onclick=()=>{if(window.T3K&&window.T3K.connect){sessionStorage.setItem('t3k_new_search_return',JSON.stringify(t3kTarget));window.T3K.connect().catch(err=>{sessionStorage.removeItem('t3k_new_search_return');el('nam8T3KResults').textContent=err.message;});}else el('nam8T3KResults').textContent='TONE3000 module unavailable';};}modal.style.display='flex';el('nam8T3KTarget').textContent='Target: '+(format==='ir'?target:'NAM '+target);const gear=el('nam8T3KGear');if(format==='ir')gear.value='cab';else if(gear.value==='cab')gear.value='amp';el('nam8T3KResults').textContent=(window.T3K&&window.T3K.connected&&window.T3K.connected())?'Search for a model, then choose a variant.':'Connect to TONE3000, then search.';}
async function searchT3K(){const box=el('nam8T3KResults');if(!box)return;try{if(!window.T3K||!T3K.connected())throw new Error('Connect to TONE3000 first');box.textContent='Searching…';const q=el('nam8T3KQuery').value.trim(),gear=el('nam8T3KGear').value,fmt2=t3kTarget.format==='ir'?'ir':'nam';const res=await T3K.search({query:q,gears:gear,format:fmt2,sort:'trending',page:1,page_size:30});const list=Array.isArray(res)?res:(res.data||res.tones||res.results||[]);box.innerHTML='';if(!list.length){box.textContent='No results found.';return;}list.forEach(t=>{const b=document.createElement('button');b.type='button';b.style.cssText='display:block;width:100%;text-align:left;padding:10px;background:#111827;color:#e2e8f0;border:0;border-bottom:1px solid #263347;';b.textContent=(t.title||t.name||'Untitled')+' · '+(t.gear||t.format||gear)+' · '+((t.user&&t.user.username)||'');b.onclick=()=>showT3KModels(t);box.appendChild(b);});}catch(e){box.textContent='Search failed: '+(e.message||e);}}
function preferredA2Lite(models){if(!Array.isArray(models))return null;return models.find(m=>/\bA2[\s_-]*Lite\b/i.test(String(m&&m.name||'')))||null;}
function explicitTierForVariant(json,model){if(!json||json.architecture!=='SlimmableContainer'||!json.config||!Array.isArray(json.config.submodels)||!(/\bA2[\s_-]*Full\b/i.test(String(model&&model.name||''))))return null;const vals=json.config.submodels.map(x=>Number(x&&x.max_value)).filter(Number.isFinite);return vals.length?Math.max(...vals):null;}
async function showT3KModels(tone){const box=el('nam8T3KResults');box.textContent='Loading model variants…';try{const isIR=t3kTarget.format==='ir'||String(tone.format||'').toLowerCase()==='ir';const res=await T3K.listModels(tone.id),models=Array.isArray(res)?res:(res.data||res.models||[]);box.innerHTML='';if(!models.length){box.textContent=isIR?'No downloadable IR models were returned.':'No downloadable model variants.';return;}if(!isIR){const lite=preferredA2Lite(models);if(lite){box.textContent='A2 Lite available — loading…';await loadT3KTone(tone,lite,false,models);return;}}models.forEach((m,i)=>{const b=document.createElement('button');b.type='button';b.style.cssText='display:block;width:100%;text-align:left;padding:10px;background:#111827;color:'+(isIR?'#5eead4':'#e2e8f0')+';border:0;border-bottom:1px solid #263347;';b.textContent=(m.name||(isIR?'IR model':'NAM model'))+' · ID '+(m.id==null?i+1:m.id);b.onclick=()=>loadT3KTone(tone,m,isIR,models);box.appendChild(b);});}catch(e){box.textContent='Variants failed: '+(e.message||e);}}
async function loadT3KTone(tone,model,isIR,allModels){const box=el('nam8T3KResults');try{box.textContent='Resolving selected variant…';if(T3K.resolveModel){const resolved=await T3K.resolveModel(tone.id,model);model=resolved.model;if(resolved.variants&&resolved.variants.length)allModels=resolved.variants;}if(!model||!model.model_url)throw new Error('TONE3000 returned no download URL for the selected variant');box.textContent='Downloading '+(model.name||'variant')+'…';const blob=await T3K.downloadModel(model.model_url);let toneMeta=tone||{},thumb=toneThumbnail(toneMeta,model);if(!thumb&&toneMeta.id!=null&&T3K.getTone){try{const raw=await T3K.getTone(toneMeta.id),detail=raw&&(raw.data||raw);if(detail){toneMeta=Object.assign({},toneMeta,detail);thumb=toneThumbnail(toneMeta,model);}}catch(e){}}const label=(toneMeta.title||toneMeta.name||'TONE3000')+(model.name?' — '+model.name:'');if(isIR||t3kTarget.format==='ir'){const c=audioContext();if(!c)throw new Error('Audio engine is not ready');const buf=await c.decodeAudioData(await blob.arrayBuffer());await setIR(t3kTarget.target,buf,{name:label,toneId:toneMeta.id||tone.id,modelId:model.id,modelName:model.name,toneTitle:toneMeta.title||toneMeta.name||'',thumbnail:thumb});}else{const json=JSON.parse(await blob.text());let variants=Array.isArray(allModels)?allModels:[];if(!variants.some(x=>String(x.id)===String(model.id))){try{const vr=await T3K.listModels(toneMeta.id||tone.id),a=Array.isArray(vr)?vr:(vr&&((vr.data)||(vr.models)))||[];if(a.length)variants=a;}catch(e){}}if(!variants.some(x=>String(x.id)===String(model.id)))variants.push(model);await setNAM(t3kTarget.target,json,{name:label,tier:explicitTierForVariant(json,model),toneId:toneMeta.id||tone.id,modelId:model.id,modelName:model.name,toneTitle:toneMeta.title||toneMeta.name||'',variants,thumbnail:thumb,enabled:true});}const modal=el('nam8T3KModal');if(modal)modal.style.display='none';status(label+' loaded');}catch(e){box.textContent='Load failed: '+(e.message||e);paintRig();}}
async function switchNAMVariant(key,model){
 const st=NAM[key];if(!st||!model||!st.toneId)return;
 try{
  let picked=model,variants=Array.isArray(st.variants)?st.variants:[];
  // Resolve the selected ID against a fresh TONE3000 list before downloading.
  if(T3K.resolveModel){const resolved=await T3K.resolveModel(st.toneId,model);picked=resolved.model;if(resolved.variants&&resolved.variants.length)variants=resolved.variants;}
  else {const vr=await T3K.listModels(st.toneId);const fresh=Array.isArray(vr)?vr:(vr&&((vr.data)||(vr.models)))||[];if(fresh.length){variants=fresh;picked=fresh.find(x=>String(x.id)===String(model.id))||picked;}}
  if(!picked.model_url)throw new Error('TONE3000 did not return a download URL for variant '+(picked.name||picked.id||''));
  status('Loading '+(picked.name||'variant')+' into '+key+'…');
  const blob=await T3K.downloadModel(picked.model_url),json=JSON.parse(await blob.text());
  if(!variants.some(x=>String(x.id)===String(picked.id)))variants=variants.concat([picked]);
  await setNAM(key,json,{name:(st.toneTitle||st.toneId)+(picked.name?' — '+picked.name:''),tier:explicitTierForVariant(json,picked),toneId:st.toneId,modelId:picked.id,modelName:picked.name||'',toneTitle:st.toneTitle,variants,thumbnail:st.thumbnail,enabled:st.enabled});
 }catch(e){status(key+' variant switch failed: '+(e.message||e));paintRig();}
}
async function loadT3KModel(slot,tone,model){if(IR_KEYS.includes(slot)||['cab','IR','IR-L','IR-R'].includes(slot)){t3kTarget={target:IR_KEYS.includes(slot)?slot:(slot==='IR-R'?'IR3':slot==='IR-L'?'IR1':'IR1'),format:'ir'};}else{t3kTarget={target:keyAlias(slot==='pedal'?'L1':slot==='amp'?'L2':slot),format:'nam'};}if(t3kTarget.format==='ir'){const blob=await T3K.downloadModel(model.model_url),c=audioContext();if(!c)throw new Error('Audio engine is not ready');const buf=await c.decodeAudioData(await blob.arrayBuffer());await setIR(t3kTarget.target,buf,{name:(tone.title||tone.name||'TONE3000')+(model.name?' — '+model.name:''),toneId:tone.id,modelId:model.id,modelName:model.name,toneTitle:tone.title,thumbnail:toneThumbnail(tone,model)});}else{const blob=await T3K.downloadModel(model.model_url);let variants=[];try{const vr=await T3K.listModels(tone.id);variants=Array.isArray(vr)?vr:(vr&&((vr.data)||(vr.models)))||[];}catch(e){}if(!variants.some(x=>String(x.id)===String(model.id)))variants.push(model);await setNAM(t3kTarget.target,JSON.parse(await blob.text()),{name:(tone.title||tone.name||'TONE3000')+(model.name?' — '+model.name:''),toneId:tone.id,modelId:model.id,modelName:model.name,toneTitle:tone.title,variants,thumbnail:toneThumbnail(tone,model)});}}
function initialize(){buildUI();loadSnapshots().catch(e=>console.warn('[NAM8 snapshots]',e));const panel=el('rigPanel');if(panel){panel.style.maxHeight='min(76vh,900px)';panel.style.overflowY='auto';}window.RigSnapshotBridge={version:VERSION,getSnapshot:i=>SNAPSHOTS[i]||null,getSnapshotForDisk:i=>SNAPSHOTS[i]?snapshotForDisk(SNAPSHOTS[i]):null,loadFromDisk:loadSnapshots,capture,saveCurrent:saveSnapshot,clearIR:()=>clearIR('ALL'),recall:recallSnapshot,loadT3KModel,setStatus:status};window.NAM8={version:VERSION,slots:NAM,ir:IR,route,setModel:setNAM,clearSlot:clearNAM,setIR,clearIR,setEnabled:setNAMEnabled,setInputMode:(side,mode)=>{side=String(side||'').toUpperCase();if(!SIDES.includes(side)||!['both','left','right'].includes(mode))throw new Error('Invalid side/input mode');inputModes[side]=mode;try{window.localStorage.setItem(INPUT_MODE_KEY+'.'+side,mode);}catch(e){}return route().then(paintRig);},capture,recall:restoreSnapshot,isActive:active};paintRig();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
window.registerModule&&window.registerModule('rig',{version:VERSION,isStub:false,NAMRealtime:window.NAMRealtime,NAM8:window.NAM8,T3K:window.T3K});
console.log('[modules] single-chain 8-NAM/4-IR stereo-out rig '+VERSION+' · max two live NAMs · lazy CPU-budget activation');
})();
