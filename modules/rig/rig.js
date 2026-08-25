// modules/rig/rig.js
// version: 4.9.8.860
// Realtime NAM (WASM) + TONE3000 client + RIG UI (pedal/amp/cab)
// Fetches models online from tone3000.com; inference runs locally.
// Depends on: NAMEngine (modules/nam) for offline / _namActive check.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.861h-lite20';
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
      const gate=context.createDynamicsCompressor();   // used as downward gate via threshold
      gate.threshold.value=-80; gate.knee.value=0; gate.ratio.value=20; gate.attack.value=0.003; gate.release.value=0.15;
      const bass=context.createBiquadFilter(); bass.type='lowshelf'; bass.frequency.value=120; bass.gain.value=0;
      const mid=context.createBiquadFilter(); mid.type='peaking'; mid.frequency.value=800; mid.Q.value=0.7; mid.gain.value=0;
      const treble=context.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=3000; treble.gain.value=0;
      const outGain=context.createGain(); outGain.gain.value=1;
      const wetSend=context.createGain(); wetSend.gain.value=0;   // dry by default; feeds shared rig reverb
      wetSend.connect(_rigVerb);
      // internal wiring: in->drive->gate->bass->mid->treble->out (NAM node splices between gate and bass externally)
      return { inGain, drive, gate, bass, mid, treble, outGain, wetSend, gateOn:false, eqOn:true, driveAmt:0 };
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
    _ctx=_ctx||(window.getAC&&window.getAC());
    const ac2=_ctx; if(!ac2) return;
    buildFx(ac2);
    const src=window._namMasterNode, dst=(window._MASTERCLIP||ac2.destination);
    const cab=window._IRCAB, comp=window._COMP_NODE;
    if(pedalOn) await ensurePedal(ac2);
    if(ampOn) await ensureAmp(ac2);
    // tear down every node's outputs
    try{ src.disconnect(); }catch(e){}
    for(const k of ['pedal','amp','cab']){ const f=fx[k]; if(!f)continue;
      for(const n of [f.inGain,f.drive,f.gate,f.bass,f.mid,f.treble,f.outGain,f.wetSend]){ try{n.disconnect();}catch(e){} } }
    try{ if(nodePedal) nodePedal.disconnect(); }catch(e){}
    try{ if(nodeAmp) nodeAmp.disconnect(); }catch(e){}
    try{ if(cab) cab.disconnect(); }catch(e){}
    try{ if(_rigVerb) _rigVerb.disconnect(); }catch(e){}
    try{ if(_rigVerbSum) _rigVerbSum.disconnect(); }catch(e){}
    // wetSend feeds the shared reverb (re-established after teardown)
    for(const k of ['pedal','amp','cab']){ const f=fx[k]; if(f&&_rigVerb) f.wetSend.connect(_rigVerb); }
    if(_rigVerb) _rigVerb.connect(_rigVerbSum);
    // helper: wire one slot's fx around a processing node. Returns tail.
    // chain: prev -> inGain -> drive -> [gate] -> node -> [bass->mid->treble] -> outGain (+wet send)
    function wireSlot(prev, f, node){
      prev.connect(f.inGain);
      f.inGain.connect(f.drive);
      let t=f.drive;
      if(f.gateOn){ t.connect(f.gate); t=f.gate; }
      if(node){ t.connect(node); t=node; }
      if(f.eqOn){ t.connect(f.bass); f.bass.connect(f.mid); f.mid.connect(f.treble); t=f.treble; }
      t.connect(f.outGain);
      f.outGain.connect(f.wetSend);   // parallel wet send (dry level unchanged)
      return f.outGain;
    }
    let tail=src;
    if(pedalOn){ tail=wireSlot(tail, fx.pedal, nodePedal); }
    if(ampOn){ tail=wireSlot(tail, fx.amp, nodeAmp); }
    if(irOn && cab){ tail=wireSlot(tail, fx.cab, cab); }
    if(pedalOn||ampOn||irOn){ tail.connect(dst); if(_rigVerbSum) _rigVerbSum.connect(dst); }
    else { if(comp){ src.connect(comp); } else { src.connect(dst); } }
    _pedalOn=pedalOn; _ampOn=ampOn; _irOn=irOn; active=pedalOn||ampOn||irOn;
    srcNode=src; dstNode=dst;
  }
  // parameter setters per slot
  function setParam(slot, param, value){
    const f=fx[slot]; if(!f) return;
    if(param==='input') f.inGain.gain.value=Math.pow(10, value/20);       // dB
    else if(param==='output') f.outGain.gain.value=Math.pow(10, value/20); // dB
    else if(param==='threshold') f.gate.threshold.value=value;             // dB
    else if(param==='bass') f.bass.gain.value=(value-5)*3;                 // 0-10 -> -15..+15 dB
    else if(param==='middle') f.mid.gain.value=(value-5)*3;
    else if(param==='treble') f.treble.gain.value=(value-5)*3;
    else if(param==='drive'){ f.driveAmt=value; f.drive.curve=makeDriveCurve(value); }  // 0-10 saturation
    else if(param==='wet') f.wetSend.gain.value=Math.max(0,Math.min(1,value/10));         // 0-10 -> 0..1 reverb send
  }
  function setFxEnabled(slot, which, on){
    const f=fx[slot]; if(!f) return;
    if(which==='gate') f.gateOn=on; else if(which==='eq') f.eqOn=on;
    route(_pedalOn,_ampOn,_irOn);   // rewire
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
      const msg={type:'model', module, layout:em.layout};
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
    const IO_IN=idx; idx+=128; const IO_OUT=idx; idx+=128;
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
    for(let i=1;i<las.length;i++)
      if(las[i].la.inputSize!==las[i-1].la.headOut) throw new Error('realtime NAM: layer-array chain size mismatch');
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
    super();
    this.cur=null; this.next=null; this.bypass=true; this._pinged=false;
    this._ovr=0; this._fade=0;
    this.port.onmessage=(e)=>{
      const d=e.data;
      if(d.type==='model'){
        try{
          const inst=new WebAssembly.Instance(d.module);   // module precompiled on main thread
          const buf=inst.exports.m.buffer;
          const memF=new Float32Array(buf), memI=new Int32Array(buf);
          for(const w of d.layout.writesF) memF.set(w.data, w.off);
          for(const w of d.layout.writesI) memI.set(w.data, w.off);
          this.next={ p:inst.exports.p, memF, ioIn:d.layout.ioIn, ioOut:d.layout.ioOut };
          this.bypass=false; this._pinged=false; this._ovr=0;
          this.port.postMessage({type:'ready'});
        }catch(err){ this.port.postMessage({type:'error',msg:err.message}); }
      }
      else if(d.type==='bypass'){ this.bypass=d.value; }
    };
  }
  process(inputs,outputs){
    const inp=inputs[0], out=outputs[0];
    if(!inp||!inp.length){ return true; }
    const inCh=inp[0], L=inCh.length;
    const outL=out[0], outR=out[1]||out[0];
    if(this.next){ this.cur=this.next; this.next=null; this._fade=128; }  // swap at block edge
    const m=this.cur;
    if(this.bypass||!m){ for(let i=0;i<L;i++){ outL[i]=inCh[i]; if(out[1])outR[i]=inCh[i]; } return true; }
    if(!this._pinged){ this._pinged=true; this.port.postMessage({type:'processing'}); }
    const t0=(typeof performance!=='undefined'&&performance.now)?performance.now():0;
    let off=0;
    while(off<L){                                     // io region is 128 floats — chunk if bigger
      const n=Math.min(128,L-off);
      for(let i=0;i<n;i++) m.memF[m.ioIn+i]=inCh[off+i];
      m.p(n);
      if(this._fade>0){
        const F=128;
        for(let i=0;i<n;i++){ const done=128-this._fade+i; const g=done<F? done/F : 1;
          const y=m.memF[m.ioOut+i]*g + inCh[off+i]*(1-g); outL[off+i]=y; if(out[1])outR[off+i]=y; }
        this._fade=Math.max(0,this._fade-n);
      } else {
        for(let i=0;i<n;i++){ const y=m.memF[m.ioOut+i]; outL[off+i]=y; if(out[1])outR[off+i]=y; }
      }
      off+=n;
    }
    if(t0){ const dt=performance.now()-t0; const budgetMs=(L/sampleRate)*1000;
      if(dt>budgetMs*0.7){ this._ovr++; if(this._ovr===20){ this.port.postMessage({type:'overrun'}); } }
      else if(this._ovr>0){ this._ovr--; } }
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
    let arch=json.architecture, cfg=json.config, sr=json.sample_rate;
    if(arch==='SlimmableContainer'){
      const subs=cfg.submodels;
      const pick=tier!=null?subs.find(s=>s.max_value===tier):subs.reduce((a,b)=>b.max_value>a.max_value?b:a);
      arch=pick.model.architecture; cfg=pick.model.config; sr=json.sample_rate||sr;
      var weights=pick.model.weights;
    } else weights=json.weights;
    if(arch!=='WaveNet') throw new Error('realtime NAM: only WaveNet supported');
    let wp=0; const nextN=(n)=>{ const s=weights.slice(wp,wp+n); wp+=n; return s; };
    const layerArrays=cfg.layers.map(lc=>{
      const gated=Array.isArray(lc.gating_mode)?lc.gating_mode.some(g=>g&&g!=='none'):!!lc.gating_mode;
      if(gated) throw new Error('realtime NAM: gated path unsupported');
      if(lc.bottleneck!==undefined && lc.bottleneck!==lc.channels) throw new Error('realtime NAM: bottleneck unsupported');
      for(const k of ['conv_pre_film','conv_post_film','input_mixin_pre_film','input_mixin_post_film','activation_pre_film','activation_post_film','layer1x1_post_film','head1x1_post_film']) if(lc[k]&&lc[k].active) throw new Error('realtime NAM: FiLM unsupported');
      const C=lc.channels, N=lc.dilations.length;
      const slopes=lc.dilations.map((_,i)=>{ const a=Array.isArray(lc.activation)?lc.activation[i]:lc.activation; return (a&&a.negative_slope!=null)?a.negative_slope:0.01; });
      // count total weights for this layer-array in exact consumption order, then slice one flat block
      const head=lc.head; let count=C*lc.input_size;
      for(let i=0;i<N;i++){ const k=lc.kernel_sizes[i]; count+=C*C*k + C + C*lc.condition_size + C*C + C; }
      count += head.out_channels*C*head.kernel_size + (head.bias?head.out_channels:0);
      const block=Float32Array.from(nextN(count));
      return { inputSize:lc.input_size, condSize:lc.condition_size, channels:C,
               dilations:lc.dilations.slice(), kernelSizes:lc.kernel_sizes.slice(), slopes,
               headOut:head.out_channels, headK:head.kernel_size, headBias:!!head.bias, weights:block };
    });
    const headScale=weights[wp];
    const maxKernel=Math.max.apply(null, cfg.layers.map(l=>Math.max(l.head.kernel_size,Math.max.apply(null,l.kernel_sizes))));
    return { layerArrays, headScale, maxKernel, sampleRate:sr };
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
  function listModels(toneId){ return authed('/models?tone_id='+encodeURIComponent(toneId)+'&architecture=2&page_size=100'); }
  async function downloadModel(modelUrl){
    const t=await token();
    const r=await fetch(modelUrl,{ headers:{ Authorization:'Bearer '+t } });
    if(!r.ok) throw new Error('download failed '+r.status);
    return r.blob();
  }

  return { configured, connected, connect, handleCallback, clearTokens, search, favorited, listModels, downloadModel };
})();
window.T3K=T3K;

// ── RIG module — pedal/amp/cab slots, file or TONE3000 load, dropdown UI ─────────
(function(){
  const btnRig=document.getElementById('btnRig'), panel=document.getElementById('rigPanel');
  const fileNam=document.getElementById('rigFileNam'), fileIr=document.getElementById('rigFileIr');
  const rigStat=document.getElementById('rigStat');
  // per-slot state
  const S={ pedal:{loaded:false,json:null}, amp:{loaded:false,json:null}, cab:{loaded:false} };
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
        try{ window.ensureAudio&&window.ensureAudio(); }catch(err){}
        if(slot==='pedal') NAMRealtime.route(!NAMRealtime.pedalOn, NAMRealtime.ampOn, NAMRealtime.irOn).then(()=>{paint();toggleBtn();});
        else if(slot==='amp') NAMRealtime.route(NAMRealtime.pedalOn, !NAMRealtime.ampOn, NAMRealtime.irOn).then(()=>{paint();toggleBtn();});
        else NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, !NAMRealtime.irOn).then(()=>{paint();toggleBtn();});
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

  // Build GATEWAY-style param panel for each slot (Input/Threshold/Bass/Middle/Treble/Output + gate/EQ)
  function buildFxPanel(slot){
    const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]'); if(!fp||fp._built) return;
    fp._built=true;
    fp.style.cssText='display:none;background:#1e1033;border:1px solid #7c3aed;border-radius:5px;padding:8px;margin:2px 0 4px 50px;';
    // knob rows: [param, label, min, max, default, unit]
    const knobs=[
      ['input','Input',-20,20,0,'dB'],
      ['drive','Drive',0,10,0,''],
      ['threshold','Threshold',-80,0,-80,'dB'],
      ['bass','Bass',0,10,5,''],
      ['middle','Middle',0,10,5,''],
      ['treble','Treble',0,10,5,''],
      ['wet','Wet',0,10,0,''],
      ['output','Output',-20,20,0,'dB']
    ];
    let html='<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;">';
    for(const [p,label,mn,mx,dv,unit] of knobs){
      html+='<div style="display:flex;flex-direction:column;align-items:center;gap:2px;min-width:60px;flex:1;">'
        +'<span style="color:#9ab;font-size:0.9em;font-weight:700;">'+label+'</span>'
        +'<input type="range" class="fxKnob" data-slot="'+slot+'" data-param="'+p+'" min="'+mn+'" max="'+mx+'" step="0.1" value="'+dv+'" style="width:100%;accent-color:#38bdf8;">'
        +'<span class="fxVal" data-for="'+p+'" style="color:#7dd3fc;font-size:0.85em;">'+dv.toFixed(1)+unit+'</span>'
        +'</div>';
    }
    html+='</div><div style="display:flex;gap:20px;margin-top:6px;justify-content:center;">'
      +'<label style="display:flex;align-items:center;gap:5px;color:#9ab;cursor:pointer;"><input type="checkbox" class="fxToggle" data-slot="'+slot+'" data-fx="gate" style="accent-color:#10b981;">Noise Gate</label>'
      +'<label style="display:flex;align-items:center;gap:5px;color:#9ab;cursor:pointer;"><input type="checkbox" class="fxToggle" data-slot="'+slot+'" data-fx="eq" checked style="accent-color:#10b981;">EQ</label>'
      +'</div>';
    fp.innerHTML=html;
    const _unitOf={}; for(const [p,,,,,u] of knobs){ _unitOf[p]=u; }
    // wire knobs
    fp.querySelectorAll('.fxKnob').forEach(k=>{
      k.addEventListener('input',()=>{
        const val=parseFloat(k.value), param=k.dataset.param, unit=_unitOf[param]||'';
        window.ensureAudio&&window.ensureAudio();
        NAMRealtime.setParam(k.dataset.slot, param, val);
        const vs=fp.querySelector('.fxVal[data-for="'+param+'"]'); if(vs) vs.textContent=val.toFixed(1)+unit;
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
      pedal:{ json:S.pedal.json, loaded:S.pedal.loaded, tier:(()=>{const s=slotEl('pedal').querySelector('.rigTier');return s&&s.style.display!=='none'?parseFloat(s.value):null;})(), name:slotEl('pedal').querySelector('.rigName').textContent, fx:grabFx('pedal') },
      amp:{ json:S.amp.json, loaded:S.amp.loaded, tier:(()=>{const s=slotEl('amp').querySelector('.rigTier');return s&&s.style.display!=='none'?parseFloat(s.value):null;})(), name:slotEl('amp').querySelector('.rigName').textContent, fx:grabFx('amp') },
      cab:{ buf:(window._IRCAB&&window._IRCAB.buffer)||null, ir:serializeIR((window._IRCAB&&window._IRCAB.buffer)||null), loaded:S.cab.loaded, name:slotEl('cab').querySelector('.rigName').textContent, fx:grabFx('cab') },
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
    try{
      const st=window.SampleStore; if(!st||!st.saveSnap) return;
      if(SNAPS[i]) st.saveSnap(i, snapForDisk(SNAPS[i])).catch(e=>console.warn('[snap save]',e));
      else st.delSnap(i).catch(()=>{});
    }catch(e){ console.warn('[snap persist]',e); }
  }
  // restore all four slots from IndexedDB on boot
  async function loadSnapsFromDisk(){
    try{
      const st=window.SampleStore; if(!st||!st.loadSnap) return;
      for(let i=0;i<4;i++){
        const d=await st.loadSnap(i);
        if(d){ if(d.cab&&d.cab.ir) d.cab.buf=null;   // rebuilt lazily on recall (needs live AudioContext)
               SNAPS[i]=d; }
      }
      paintSnaps();
    }catch(e){ console.warn('[snap load]',e); }
  }
  function restoreFx(slot, fx){
    const fp=panel.querySelector('.rigFxPanel[data-slot="'+slot+'"]'); if(!fp||!fp._built||!fx) return;
    fp.querySelectorAll('.fxKnob').forEach(k=>{ const p=k.dataset.param;
      if(fx.knobs[p]!=null){ k.value=fx.knobs[p]; NAMRealtime.setParam(slot,p,fx.knobs[p]);
        const unit=(p==='input'||p==='threshold'||p==='output')?'dB':'';
        const vs=fp.querySelector('.fxVal[data-for="'+p+'"]'); if(vs) vs.textContent=fx.knobs[p].toFixed(1)+unit; } });
    fp.querySelectorAll('.fxToggle').forEach(t=>{ const want=!!fx[t.dataset.fx];
      if(t.checked!==want){ t.checked=want; NAMRealtime.setFxEnabled(slot,t.dataset.fx,want); } });
  }
  async function snapRecall(i){
    const sn=SNAPS[i]; if(!sn){ snapStat.textContent='slot '+(SNAP_LABELS[i]||i)+' empty — tap SAVE then '+(SNAP_LABELS[i]||i); setTimeout(()=>snapStat.textContent='',2500); return; }
    window.ensureAudio&&window.ensureAudio();
    setStat('recalling '+(SNAP_LABELS[i]||i)+'…');
    // pedal
    S.pedal.json=sn.pedal.json; S.pedal.loaded=sn.pedal.loaded;
    const pSel=slotEl('pedal').querySelector('.rigTier');
    if(sn.pedal.loaded&&sn.pedal.json){
      const pt=NAMEngine.tiers(sn.pedal.json);
      if(pt&&pSel){ pSel.innerHTML=pt.map((t,j)=>'<option value="'+t+'">q'+t+(j===pt.length-1?' (smooth)':j===0?' (heavy)':'')+'</option>').join('');
        pSel.value=String(sn.pedal.tier!=null?sn.pedal.tier:(function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(pt)); pSel.style.display='inline-block'; }   // v615: restore defaults to ~q0.64
      else if(pSel){ pSel.style.display='none'; pSel.innerHTML=''; }
      NAMRealtime.setModel('pedal',sn.pedal.json,sn.pedal.tier);
    } else if(pSel){ pSel.style.display='none'; pSel.innerHTML=''; }
    slotEl('pedal').querySelector('.rigName').textContent=sn.pedal.name||'';
    // amp
    S.amp.json=sn.amp.json; S.amp.loaded=sn.amp.loaded;
    const aSel=slotEl('amp').querySelector('.rigTier');
    if(sn.amp.loaded&&sn.amp.json){
      const at=NAMEngine.tiers(sn.amp.json);
      if(at&&aSel){ aSel.innerHTML=at.map((t,j)=>'<option value="'+t+'">q'+t+(j===at.length-1?' (smooth)':j===0?' (heavy)':'')+'</option>').join('');
        aSel.value=String(sn.amp.tier!=null?sn.amp.tier:(function(ts){let b=ts[0],e=9;for(const t of ts){const d=Math.abs(t-0.64);if(d<e){e=d;b=t;}}return b;})(at)); aSel.style.display='inline-block'; }   // v615: restore defaults to ~q0.64
      else if(aSel){ aSel.style.display='none'; aSel.innerHTML=''; }
      NAMEngine.loadFromJSON(sn.amp.json, sn.amp.tier!=null?sn.amp.tier:undefined);
      NAMRealtime.setModel('amp',sn.amp.json,sn.amp.tier);
    } else if(aSel){ aSel.style.display='none'; aSel.innerHTML=''; }
    slotEl('amp').querySelector('.rigName').textContent=sn.amp.name||'';
    // cab — rebuild the AudioBuffer if this snap came from disk (buf stripped, ir kept)
    S.cab.loaded=sn.cab.loaded;
    if(sn.cab.loaded && !sn.cab.buf && sn.cab.ir){ try{ sn.cab.buf=deserializeIR(sn.cab.ir); }catch(e){ console.warn('[snap IR rebuild]',e); } }
    NAMRealtime.setIR(sn.cab.loaded?sn.cab.buf:null);
    slotEl('cab').querySelector('.rigName').textContent=sn.cab.name||'';
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

  // tier change (slot-aware)
  panel&&panel.addEventListener('change',(e)=>{
    if(!e.target.classList.contains('rigTier')) return;
    const slotDiv=e.target.closest('.rigSlot'); const slot=slotDiv?slotDiv.dataset.slot:'amp';
    const st=S[slot]; if(st&&st.json){
      if(slot==='amp') NAMEngine.loadFromJSON(st.json,parseFloat(e.target.value));
      try{ NAMRealtime.setModel(slot,st.json,parseFloat(e.target.value)); }catch(err){ console.warn(err); } }
  });

  function clearSlot(slot){
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
    const json=JSON.parse(txt); S[slot].json=json; S[slot].loaded=true;
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
  t3kClose&&t3kClose.addEventListener('click',()=>{ modal.style.display='none'; });

  function openT3k(slot){
    t3kTargetSlot=slot;
    if(location.protocol!=='https:'){ setStat('T3K search needs https hosting; use 📁 File here'); return; }
    if(!T3K.configured()){ setStat('T3K: set publishable key (line 108)'); return; }
    if(!T3K.connected()){ setStat('connecting to TONE3000…'); T3K.connect().catch(err=>setStat('connect failed: '+err.message)); return; }
    // preset format filter to slot
    if(t3kFormat) t3kFormat.value = (slot==='cab')?'ir':'nam';
    modal.style.display='flex'; curPage=1; runSearch();
  }
  async function loadTone(tone){
    t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#7dd3fc;">loading '+(tone.title||'tone')+'…</div>';
    try{
      const res=await T3K.listModels(tone.id); const models=res.data||res;
      if(!models||!models.length){ t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">No A2 models.</div>'; return; }
      const m=models[0]; const blob=await T3K.downloadModel(m.model_url);
      modal.style.display='none';
      const slot=t3kTargetSlot||'amp';
      const isIR=(tone.format==='ir')||(slot==='cab');
      if(isIR){ loadIrBlob(blob, tone.title||m.name); }
      else { applyNam(await blob.text(), slot==='cab'?'amp':slot, tone.title||m.name); }
    }catch(err){ var msg=(err&&err.message)||(typeof err==='string'?err:'network/CORS error');
      t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">Load failed: '+msg+'<br><span style="font-size:0.85em;opacity:0.8;">TONE3000 search needs the app served over https.</span></div>';
      console.warn('[T3K] load failed:',err); }
  }
  function loadIrBlob(blob, name){
    window.ensureAudio&&window.ensureAudio(); const ac=window.getAC&&window.getAC();
    blob.arrayBuffer().then(ab=>ac.decodeAudioData(ab)).then(buf=>{
      NAMRealtime.setIR(buf); S.cab.loaded=true;
      slotEl('cab').querySelector('.rigName').textContent=name;
      NAMRealtime.route(NAMRealtime.pedalOn, NAMRealtime.ampOn, true).then(()=>{paint();toggleBtn();});
    }).catch(err=>setStat('cab load failed: '+err.message));
  }
  function renderResults(data){
    const tones=data.data||[];
    if(!tones.length){ t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#9aa;">No results.</div>'; t3kPager.innerHTML=''; return; }
    t3kResults.innerHTML=tones.map((t,i)=>{
      const img=(t.images&&t.images[0])||'';
      const dl=t.downloads_count!=null?('↓'+t.downloads_count):'';
      return '<div class="t3kRow" data-i="'+i+'" style="display:flex;gap:8px;align-items:center;padding:7px;border-bottom:1px solid #222;cursor:pointer;">'
        +(img?'<img src="'+img+'" style="width:38px;height:38px;object-fit:cover;border-radius:5px;flex-shrink:0;">':'<div style="width:38px;height:38px;background:#1f2937;border-radius:5px;flex-shrink:0;"></div>')
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
    try{ renderResults(await T3K.search({ query:t3kQuery.value.trim(), gears:t3kGear.value, format:t3kFormat.value, sort:t3kSort.value, page:curPage, page_size:20 })); }
    catch(err){ const msg=err.message||'';
      if(/not connected|401/.test(msg)){ t3kResults.innerHTML='<div style="padding:20px;color:#fbbf24;">Session expired — reconnecting…</div>'; T3K.connect().catch(e=>{t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">'+e.message+'</div>';}); return; }
      t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">Search failed: '+msg+'</div>'; }
  }
  t3kGo&&t3kGo.addEventListener('click',()=>{ curPage=1; runSearch(); });
  t3kQuery&&t3kQuery.addEventListener('keydown',e=>{ if(e.key==='Enter'){ curPage=1; runSearch(); } });
  [t3kGear,t3kFormat,t3kSort].forEach(sel=>sel&&sel.addEventListener('change',()=>{ curPage=1; runSearch(); }));
  t3kFav&&t3kFav.addEventListener('click',async ()=>{ t3kResults.innerHTML='<div style="padding:20px;text-align:center;color:#fbbf24;">loading favorites…</div>';
    try{ renderResults(await T3K.favorited(1)); }catch(err){ t3kResults.innerHTML='<div style="padding:20px;color:#f87171;">'+err.message+'</div>'; } });

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
      if(cb){ panel.style.display='flex'; modal.style.display='flex'; curPage=1; runSearch(); }
    }catch(e){ console.warn('[T3K cb]', e&&e.message); }
  })();

  window._namRtOverrun=function(slot){ setStat('⚠ '+(slot||'')+' CPU high, lower quality'); };
  window._namRtOnError=function(msg,slot){ setStat((slot||'amp')+' error: '+msg); };
  window._namActive=function(){ return NAMRealtime.ampOn && NAMEngine.loaded; };

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
if(!namReady() && typeof window.loadModule === 'function'){
  window.loadModule('nam').catch(function(e){
    console.warn('[rig] nam load failed', e);
  });
}
})();
