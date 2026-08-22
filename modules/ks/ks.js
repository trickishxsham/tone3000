// modules/ks/ks.js
// version: 4.9.8.860
// Karplus-Strong guitar engine (AudioWorklet)
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';

// ─── KS GUITAR ENGINE — Karplus-Strong string synthesis in an AudioWorklet ──────────
//   Native DelayNode feedback loops sound metallic (wrong interpolation). This runs the
//   textbook KS sample loop directly: circular buffer length = round(sr/freq), one-pole
//   averaging filter + decay. Verified pitch-accurate and warm. Polyphonic via voice IDs.
const KSEngine = (function(){
  let node=null, ac=null, nextId=1, pending=[];
  const SRC = `
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
`;
  let _ensuring=null;
  async function ensure(context, dest){
    if(node) return node;
    if(_ensuring) return _ensuring;
    _ensuring=(async()=>{
      ac=context;
      // Both KS + NAM processors live in ONE module (window._namLoadModule loads it once).
      // Two separate data: worklet modules fail under content:// — sharing one avoids that.
      try{ if(window._namLoadModule) await window._namLoadModule(context); else throw new Error('_namLoadModule missing'); }
      catch(e){
        // v578: the module never registered — creating the node would only throw a
        //   misleading "'ks-processor' is not defined". Bail out and let the next
        //   pluck retry, keeping the real reason on screen.
        console.error('[KS] shared module load failed:',e.message);
        window._ksFailed=e.message; _ensuring=null; return null;
      }
      try{
        node=new AudioWorkletNode(ac,'ks-processor',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
        node.port.onmessage=(e)=>{ if(e.data.type==='active'){ window._ksActive=true; } };
        node.connect(dest);
        for(const msg of pending) node.port.postMessage(msg); pending.length=0;
      }catch(e3){ console.error('[KS] node create failed:',e3.message); window._ksFailed=e3.message; _ensuring=null; }
      return node;
    })();
    return _ensuring;
  }
  function pluck(freq, vel, voice){
    const id=nextId++;
    const msg={type:'pluck', id, freq, vel:vel==null?0.8:vel, voice:voice||'clean', pickup:window._stratPickup||5};
    if(node) node.port.postMessage(msg); else pending.push(msg);
    return {
      id,
      release(){ const m={type:'release', id}; if(node) node.port.postMessage(m); else pending.push(m); },
      retune(f, instant){ const m={type:'retune', id, freq:f, instant:!!instant}; if(node) node.port.postMessage(m); else pending.push(m); },
      kill(){ const m={type:'kill', id}; if(node) node.port.postMessage(m); else pending.push(m); }
    };
  }
  return { ensure, pluck, get ready(){ return !!node; } };
})();
window.KSEngine=KSEngine;
window._stratPickup=5;   // default bridge

window.registerModule('ks', {
  version: MODULE_VERSION,
  isStub: false,
  engine: window.KSEngine
});
console.log('[modules] ks v' + MODULE_VERSION);
})();
