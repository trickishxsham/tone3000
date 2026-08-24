// modules/sampler/sampler.js
// version: 4.9.8.860
// SampleStore (IndexedDB) + sample pack library UI.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.861e';
// Shell keeps sample state in an IIFE (let _SAMP_*). Bridge via window so this module can read/write.
function _sampGet(k, d){ try{ return (window[k]!==undefined)?window[k]:d; }catch(e){ return d; } }
function _sampSet(k, v){ try{ window[k]=v; }catch(e){} }

function sampNormalizeMap(map){
  // v848: coerce + drop invalid slices (zero/negative length = dead notes)
  return (map||[]).map(function(m){
    return {rootMidi:+m.rootMidi, start:+m.start, end:+m.end, loop:!!m.loop,
      _buf:m._buf||null, _bufFull:m._bufFull||null, _bufFullLead:m._bufFullLead};
  }).filter(function(s){
    return isFinite(s.rootMidi) && isFinite(s.start) && isFinite(s.end) && s.end>s.start+0.008;
  }).sort(function(a,b){ return a.rootMidi-b.rootMidi; });
}
function ensureAudio(){
  if(typeof window.ensureAudio==='function') return window.ensureAudio();
}

const SampleStore=(function(){
  let db=null;
  function open(){ return new Promise((res,rej)=>{ if(db)return res(db);
    const r=indexedDB.open('improvs2_sample',3);
    r.onupgradeneeded=e=>{ const d=e.target.result;
      if(!d.objectStoreNames.contains('audio')) d.createObjectStore('audio',{keyPath:'id'});
      if(!d.objectStoreNames.contains('packs')) d.createObjectStore('packs',{keyPath:'id'});
      if(!d.objectStoreNames.contains('rigsnaps')) d.createObjectStore('rigsnaps',{keyPath:'id'}); };   // v539: RIG snapshots survive reload
    r.onsuccess=e=>{ db=e.target.result; res(db); }; r.onerror=e=>rej(e); }); }
  // ── RIG SNAPSHOTS (build 539) — NAM jsons are 100KB-2MB so localStorage can't hold
  //    them; IndexedDB can. AudioBuffers aren't structured-cloneable, so the cab IR is
  //    stored as raw Float32 channel data + sampleRate and rebuilt on load.
  async function saveSnap(idx, data){ const d=await open();
    try{ if(window.Vault&&window.Vault.ready) window.Vault.saveRig(idx,data); }catch(e){}   // v678: mirror to device storage
    return new Promise((res,rej)=>{ const tx=d.transaction('rigsnaps','readwrite');
      tx.objectStore('rigsnaps').put({id:'snap_'+idx, data, date:Date.now()});
      tx.oncomplete=()=>res(true); tx.onerror=e=>rej(e); }); }
  async function loadSnap(idx){ const d=await open();
    const hit=await new Promise((res)=>{ try{ const tx=d.transaction('rigsnaps','readonly');
      const rq=tx.objectStore('rigsnaps').get('snap_'+idx);
      rq.onsuccess=()=>res(rq.result?rq.result.data:null); rq.onerror=()=>res(null); }catch(e){ res(null); } });
    if(hit) return hit;
    try{ if(window.Vault&&window.Vault.ready){        // v678: IndexedDB lost it -> rebuild the slot from disk
      const fromDisk=await window.Vault.readRig(idx);
      if(fromDisk){ try{ const tx2=d.transaction('rigsnaps','readwrite');
        tx2.objectStore('rigsnaps').put({id:'snap_'+idx, data:fromDisk, date:Date.now()}); }catch(e){}
        console.log('[VAULT] rig slot '+idx+' restored from device'); return fromDisk; }
    } }catch(e){}
    return null; }
  async function delSnap(idx){ const d=await open();
    try{ if(window.Vault&&window.Vault.ready) window.Vault.dropRig(idx); }catch(e){}   // v678: clear the device copy too
    return new Promise((res)=>{ const tx=d.transaction('rigsnaps','readwrite');
      tx.objectStore('rigsnaps').delete('snap_'+idx); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }); }
  // legacy single-sample (kept for the auto-restore of an unsaved working file)
  async function save(arrayBuf,name){ const d=await open();
    return new Promise((res,rej)=>{ const tx=d.transaction('audio','readwrite');
      tx.objectStore('audio').put({id:'current', bytes:arrayBuf, name:name||'sample', date:Date.now()});
      tx.oncomplete=()=>res(true); tx.onerror=e=>rej(e); }); }
  async function load(){ const d=await open();
    return new Promise((res,rej)=>{ const tx=d.transaction('audio','readonly');
      const rq=tx.objectStore('audio').get('current');
      rq.onsuccess=()=>res(rq.result||null); rq.onerror=e=>rej(e); }); }
  // multi-pack: each pack carries its own bytes AND its map
  async function savePack(name, bytes, map, settings){ const d=await open();
    const id='pack_'+Date.now();
    return new Promise((res,rej)=>{ const tx=d.transaction('packs','readwrite');
      tx.objectStore('packs').put({id, name:name||'Pack', bytes, map:map||[], settings:settings||null, date:Date.now()});
      tx.oncomplete=()=>res(id); tx.onerror=e=>rej(e); }); }
  async function savePackAt(id, name, bytes, map, settings){ const d=await open();
    return new Promise((res,rej)=>{ const tx=d.transaction('packs','readwrite');
      tx.objectStore('packs').put({id, name:name||'Pack', bytes, map:map||[], settings:settings||null, date:Date.now()});
      tx.oncomplete=()=>res(id); tx.onerror=e=>rej(e); }); }
  async function allPacks(){ const d=await open();
    return new Promise((res,rej)=>{ const out=[]; const tx=d.transaction('packs','readonly');
      tx.objectStore('packs').openCursor().onsuccess=e=>{ const c=e.target.result;
        if(c){ out.push(c.value); c.continue(); } else res(out.sort((a,b)=>b.date-a.date)); };
      tx.onerror=e=>rej(e); }); }
  async function getPack(id){ const d=await open();
    return new Promise((res,rej)=>{ const tx=d.transaction('packs','readonly');
      const rq=tx.objectStore('packs').get(id); rq.onsuccess=()=>res(rq.result||null); rq.onerror=e=>rej(e); }); }
  async function delPack(id){ const d=await open();
    return new Promise((res)=>{ const tx=d.transaction('packs','readwrite');
      tx.objectStore('packs').delete(id); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }); }
  return { save, load, savePack, savePackAt, allPacks, getPack, delPack, saveSnap, loadSnap, delSnap };
})();
window.SampleStore=SampleStore;
// restore last-loaded pack (or legacy working sample) on startup
(async function restoreSample(){
  // coerce stored audio (ArrayBuffer | typed-array | Blob) into an ArrayBuffer for decoding
  async function toAB(bytes){
    if(!bytes) return null;
    if(bytes instanceof ArrayBuffer) return bytes.slice(0);
    if(bytes.buffer instanceof ArrayBuffer && typeof bytes.byteLength==='number') return bytes.buffer.slice(0);
    if(typeof bytes.arrayBuffer==='function') return await bytes.arrayBuffer();   // Blob
    // recover backup-serialized audio that wasn't rehydrated ({__ab|__blob, b64})
    if(bytes.b64 && (bytes.__ab||bytes.__blob)){ try{ const bin=atob(bytes.b64),u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; }catch(_){ return null; } }
    return null;
  }
  try{
    const lastId=localStorage.getItem('improvs2_lastpack');
    if(lastId){
      const p=await SampleStore.getPack(lastId);
      if(p && p.bytes){ ensureAudio(); try{ if(window._AC.state==='suspended') await window._AC.resume(); }catch(_){}
        const ab=await toAB(p.bytes);
        const st=document.getElementById('sampStatus');
        if(!ab || ab.byteLength<64){ if(st) st.textContent='last pack "'+(p.name||'').slice(0,20)+'" has no usable audio — pick a pack below or load a file'; }
        else {
          window._SAMP_BUF=await window._AC.decodeAudioData(ab.slice(0));
          window._SAMP_BYTES=ab.slice(0); window._SAMP_PACKID=p.id;
          window._SAMP_MAP=sampNormalizeMap(p.map||[]);   // v848: drop bad slices (dead notes)
      if(p.settings){ try{
        if(p.settings.pickAttack!=null){ window._SAMP_ATK=Math.max(0,Math.min(0.4,(+p.settings.pickAttack||0)/1000)); localStorage.setItem('improvs2_sampatk',String(window._SAMP_ATK)); const _pa=document.getElementById('sampPickAtk'); if(_pa) _pa.value=Math.round(window._SAMP_ATK*1000); }
        if(p.settings.aRef && document.getElementById('sampTuning')) document.getElementById('sampTuning').value=p.settings.aRef;
        if(p.settings.autocut){ window._SAMP_AUTOCUT=p.settings.autocut; try{ localStorage.setItem('improvs2_autocut', JSON.stringify(window._SAMP_AUTOCUT)); }catch(_){} }
      }catch(_){} }
          if(st) st.textContent=`✓ pack "${(p.name||'').slice(0,24)}" restored (${window._SAMP_BUF.duration.toFixed(1)}s, ${window._SAMP_MAP.length} notes)`;
          if(window.renderRows) window.renderRows();
        }
        if(typeof renderPackList==='function') renderPackList();
        return;
      }
    }
    const rec=await SampleStore.load(); if(!rec||!rec.bytes) return;
    ensureAudio(); try{ if(window._AC.state==='suspended') await window._AC.resume(); }catch(_){}
    const ab=await toAB(rec.bytes); if(!ab || ab.byteLength<64) return;
    window._SAMP_BUF=await window._AC.decodeAudioData(ab.slice(0));
    window._SAMP_BYTES=ab.slice(0);
    const st=document.getElementById('sampStatus');
    if(st) st.textContent=`✓ ${(rec.name||'sample').slice(0,30)} (restored, ${window._SAMP_BUF.duration.toFixed(1)}s)`;
    try{ const d=localStorage.getItem('improvs2_sampmap'); if(d){window._SAMP_MAP=JSON.parse(d); if(window.renderRows) window.renderRows();} }catch(_){}
    if(typeof renderPackList==='function') renderPackList();
  }catch(e){ const st=document.getElementById('sampStatus'); if(st) st.textContent='startup pack restore failed — '+(e&&e.message||'').slice(0,40); }
})();

// ── SAMPLE PACK LIBRARY UI ──
async function renderPackList(){
  const host=document.getElementById('sampPackList'); if(!host) return;
  let packs=[]; try{ packs=await SampleStore.allPacks(); }catch(e){}
  // merge external folder packs (DLC) registered via window.__SAMPLE_PACKS — tag them so
  //   LOAD knows to decode their base64/wavUrl rather than read IndexedDB bytes.
  try{
    (window.__SAMPLE_PACKS||[]).forEach(function(ep){
      if(!ep||!ep.id) return;
      if(packs.some(function(x){return x.id===ep.id;})) return;   // IDB copy wins if same id
      packs.push({ id:ep.id, name:ep.name||ep.id, map:ep.map||[], date:ep.date||Date.now(), __ext:ep });
    });
  }catch(e){}
  host.innerHTML='';
  if(!packs.length){ host.innerHTML='<div style="color:#6b7280;font-size:0.72em;">No saved packs. Load a sample, set its map, then 💾 Save as Pack.</div>'; return; }
  packs.forEach(p=>{
    const cur=(p.id===window._SAMP_PACKID);
    // a store pack is locked until bought with a token or instant-buy; user-made packs are open
    let owned=true;
    if(p.locked){ try{ owned=(JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]')).includes(p.id); }catch(e){ owned=false; } }
    const cost=p.cost||1, price=p.price||'$1.99';
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;background:'+(cur?'#064e3b':'#0b1220')+';border:1px solid '+(cur?'#10b981':'#1f2937')+';border-radius:4px;padding:6px 9px;';
    row.innerHTML='<div style="flex:1;"><div style="color:#d1fae5;font-weight:900;font-size:0.78em;font-family:Bangers,cursive;">'+(p.name||'Pack')+(p.__ext?' 📁':'')+(p.locked&&!owned?' 🔒':'')+(cur?' ◀ loaded':'')+'</div>'+
      '<div style="color:#6b8c7e;font-size:0.66em;font-family:Bangers,cursive;">'+(p.map?p.map.length:0)+' notes · '+(p.__ext?'folder pack':new Date(p.date).toLocaleDateString())+'</div></div>'+
      (p.__ext
        ? '<button data-loadext="'+p.id+'" style="padding:3px 10px;background:#0e7490;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;">LOAD</button>'
        : ((p.locked&&!owned)
          ? ( (p.free || /pack[-_]?1(\b|$|#)/i.test(p.id))
              ? '<button data-freepack="'+p.id+'" title="Claim free" style="padding:3px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;box-shadow:0 0 6px rgba(34,197,94,0.6);">🎁 FREE</button>'
              : '<button data-tokpack="'+p.id+'" title="Unlock with '+cost+' token'+(cost>1?'s':'')+'" style="padding:3px 9px;background:#6d28d9;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;">🎟 '+cost+'</button>'+
                '<button data-buypack="'+p.id+'" title="Buy now" style="padding:3px 9px;background:#0e7a4f;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;">⚡ '+price+'</button>' )
          : '<button data-loadpack="'+p.id+'" style="padding:3px 10px;background:#059669;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;">LOAD</button>'+
            '<button data-delpack="'+p.id+'" style="padding:3px 8px;background:#7f1d1d;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.7em;cursor:pointer;">✕</button>'));
    host.appendChild(row);
  });
  // claim a FREE pack (no cost)
  host.querySelectorAll('[data-freepack]').forEach(b=>b.addEventListener('click',()=>{
    try{ const u=JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]'); if(!u.includes(b.dataset.freepack)){u.push(b.dataset.freepack);localStorage.setItem('improvs2_unlocks',JSON.stringify(u));} }catch(e){}
    renderPackList();
  }));
  // token-unlock a store pack
  host.querySelectorAll('[data-tokpack]').forEach(b=>b.addEventListener('click',async()=>{
    const p=packs.find(x=>x.id===b.dataset.tokpack); const cost=(p&&p.cost)||1;
    if(Tokens.spend(cost)){ try{ const u=JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]'); if(!u.includes(b.dataset.tokpack)){u.push(b.dataset.tokpack);localStorage.setItem('improvs2_unlocks',JSON.stringify(u));} }catch(e){} renderPackList(); }
    else { var _tb=(typeof Tokens.balance==='function')?Tokens.balance():Tokens.balance; alert('Not enough tokens. You have '+_tb+' 🎟, this pack needs '+cost+'.\nLevel up your aura to earn tokens, or use ⚡ Buy.'); }
  }));
  // instant-buy a store pack
  host.querySelectorAll('[data-buypack]').forEach(b=>b.addEventListener('click',()=>{
    const p=packs.find(x=>x.id===b.dataset.buypack);
    instantBuy(b.dataset.buypack, (p&&p.price)||'$1.99', p&&p.name, ()=>{ try{ const u=JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]'); if(!u.includes(b.dataset.buypack)){u.push(b.dataset.buypack);localStorage.setItem('improvs2_unlocks',JSON.stringify(u));} }catch(e){} renderPackList(); });
  }));
  host.querySelectorAll('[data-loadpack]').forEach(b=>b.addEventListener('click',async()=>{
    const st=document.getElementById('sampStatus'); if(st) st.textContent='loading pack…';
    let p=null;
    try{
      p=await SampleStore.getPack(b.dataset.loadpack);
      if(!p){ if(st) st.textContent='pack load failed — record not found'; return; }
      if(!p.bytes){ if(st) st.textContent='pack load failed — no audio in this pack (its bytes were lost, likely an old backup). Re-save it from a working copy.'; return; }
      ensureAudio(); try{ if(window._AC.state==='suspended') await window._AC.resume(); }catch(_){}
      const ab = (p.bytes instanceof ArrayBuffer) ? p.bytes.slice(0)
               : (p.bytes && p.bytes.buffer instanceof ArrayBuffer) ? p.bytes.buffer.slice(0)
               : (p.bytes && typeof p.bytes.arrayBuffer==='function') ? await p.bytes.arrayBuffer()  // Blob
               : (p.bytes && p.bytes.b64 && (p.bytes.__ab||p.bytes.__blob)) ? (function(){ const bin=atob(p.bytes.b64),u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; })()  // recover serialized
               : null;
      if(!ab || ab.byteLength<64){ if(st) st.textContent='pack load failed — audio is empty/corrupt ('+(ab?ab.byteLength:0)+' bytes). Re-save from a working copy.'; return; }
      window._SAMP_BUF=await window._AC.decodeAudioData(ab.slice(0));
      window._SAMP_BYTES=ab.slice(0); window._SAMP_PACKID=p.id;
      window._SAMP_MAP=sampNormalizeMap(p.map||[]);   // v848: no zero-length slices
      if(p.settings){ try{
        if(p.settings.pickAttack!=null){ window._SAMP_ATK=Math.max(0,Math.min(0.4,(+p.settings.pickAttack||0)/1000)); localStorage.setItem('improvs2_sampatk',String(window._SAMP_ATK)); const _pa=document.getElementById('sampPickAtk'); if(_pa) _pa.value=Math.round(window._SAMP_ATK*1000); }
        if(p.settings.aRef && document.getElementById('sampTuning')) document.getElementById('sampTuning').value=p.settings.aRef;
        if(p.settings.autocut){ window._SAMP_AUTOCUT=p.settings.autocut; try{ localStorage.setItem('improvs2_autocut', JSON.stringify(window._SAMP_AUTOCUT)); }catch(_){} }
      }catch(_){} }
      localStorage.setItem('improvs2_lastpack', p.id);
      try{ if(window.__syncSampFromWindow) window.__syncSampFromWindow(); }catch(e){}
      if(window.renderRows) window.renderRows();
      renderPackList();
      if(st) st.textContent=`✓ pack "${(p.name||'').slice(0,24)}" (${window._SAMP_BUF.duration.toFixed(1)}s, ${window._SAMP_MAP.length} notes)`;
    }catch(e){
      const sz = p&&p.bytes ? (p.bytes.byteLength!=null?p.bytes.byteLength:(p.bytes.size!=null?p.bytes.size:'?')) : 'none';
      const ty = p&&p.bytes&&p.bytes.constructor ? p.bytes.constructor.name : typeof (p&&p.bytes);
      if(st) st.textContent='pack load failed — '+ty+' '+sz+'B · '+(e&&e.message||e||'').toString().slice(0,40);
    }
  }));
  // LOAD an external folder pack (from window.__SAMPLE_PACKS). Audio comes from base64
  //   (audioB64 — works everywhere) or a relative wavUrl (Capacitor/Play Store, where
  //   fetch of bundled assets is allowed; file:// preview usually can't fetch it).
  host.querySelectorAll('[data-loadext]').forEach(b=>b.addEventListener('click',async()=>{
    const st=document.getElementById('sampStatus'); if(st) st.textContent='loading folder pack…';
    const ep=(window.__SAMPLE_PACKS||[]).find(x=>x.id===b.dataset.loadext); if(!ep){ if(st)st.textContent='pack not found'; return; }
    try{
      if(typeof window.ensureAudio==='function') window.ensureAudio();
      else ensureAudio();
      if(!window._AC && window.getAC) window._AC=window.getAC();
      if(!window._AC) throw new Error('audio context not ready');
      let ab=null;
      if(ep.audioB64){ const bin=atob(ep.audioB64),len=bin.length,u=new Uint8Array(len); for(let i=0;i<len;i++)u[i]=bin.charCodeAt(i); ab=u.buffer; }
      else if(ep.wavUrl){ const r=await fetch(ep.wavUrl); if(!r.ok) throw new Error('wav fetch HTTP '+r.status); ab=await r.arrayBuffer(); }
      else throw new Error('no audio yet — wait for pack build or use LOAD again');
      window._SAMP_BUF=await window._AC.decodeAudioData(ab.slice(0));
      window._SAMP_BYTES=ab.slice(0); window._SAMP_PACKID=ep.id;
      window._SAMP_MAP=sampNormalizeMap(ep.map||[]);   // v848
      if(ep.aRef && document.getElementById('sampTuning')) document.getElementById('sampTuning').value=ep.aRef;
      if(ep.autocut){ window._SAMP_AUTOCUT=ep.autocut; try{ localStorage.setItem('improvs2_autocut', JSON.stringify(window._SAMP_AUTOCUT)); }catch(_){} }
      if(ep.pickAttack!=null){ window._SAMP_ATK=Math.max(0,Math.min(0.4,(+ep.pickAttack||0)/1000));
        try{ localStorage.setItem('improvs2_sampatk', String(window._SAMP_ATK)); }catch(_){}
        const pa=document.getElementById('sampPickAtk'); if(pa) pa.value=Math.round(window._SAMP_ATK*1000); }
      try{ localStorage.setItem('improvs2_sampmap', JSON.stringify(window._SAMP_MAP)); }catch(_){}
      try{ if(window.__syncSampFromWindow) window.__syncSampFromWindow(); }catch(e){}
      if(window.renderRows) window.renderRows();
      renderPackList();
      if(st) st.textContent='📁 pack "'+((ep.name||'').slice(0,24))+'" ('+window._SAMP_BUF.duration.toFixed(1)+'s, '+window._SAMP_MAP.length+' notes)';
    }catch(e){ if(st) st.textContent='folder pack load failed: '+(e&&e.message||'').slice(0,30)+(ep.wavUrl&&!ep.audioB64?' (file:// can\'t fetch .wav — use a base64 .pack.js)':''); }
  }));
  host.querySelectorAll('[data-delpack]').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('Delete this pack?')) return;
    await SampleStore.delPack(b.dataset.delpack);
    if(window._SAMP_PACKID===b.dataset.delpack){ window._SAMP_PACKID=null; localStorage.removeItem('improvs2_lastpack'); }
    renderPackList();
  }));
}
window.renderSamplePackList=renderPackList;   // external packs call this on register to refresh the list
// v861: packs may have registered before this module loaded — paint list now
try{ renderPackList(); }catch(e){}
// If CDN packs not yet fetched (shell loader may have run), re-pull manifest once
(function refreshPacksOnBoot(){
  try{
    var MANIFEST='https://raw.githubusercontent.com/trickishxsham/samplepacks/main/packs.json';
    var CDN='https://cdn.jsdelivr.net/gh/trickishxsham/samplepacks@main/';
    function injectPack(p){
      if(!p||!p.file) return;
      var id=p.id||p.file;
      if(document.querySelector('script[data-pack="'+id+'"]')) return;
      // already registered?
      if(window.__SAMPLE_PACKS && window.__SAMPLE_PACKS.some(function(x){return x.id===id;})) return;
      var s=document.createElement('script');
      s.src=CDN+p.file;
      s.setAttribute('data-pack', id);
      s.onload=function(){ try{ setTimeout(function(){ renderPackList(); }, 400); }catch(e){} };
      s.onerror=function(){ console.warn('[sampler] pack script failed', id); };
      document.head.appendChild(s);
    }
    // Always ensure legendary.bloomfield is requested (main DLC pack)
    injectPack({ id:'legendary.bloomfield', file:'packs/legendary.bloomfield.pack.js' });
    fetch(MANIFEST).then(function(r){ return r.json(); }).then(function(j){
      ((j&&j.packs)||[]).forEach(injectPack);
    }).catch(function(){});
    // pack.js registerLightweight is async (fetches 45 WAV headers) — poll for it
    var _tries=0;
    var _poll=setInterval(function(){
      _tries++;
      try{ renderPackList(); }catch(e){}
      var has=window.__SAMPLE_PACKS && window.__SAMPLE_PACKS.some(function(x){ return x.id==='legendary.bloomfield'; });
      if(has || _tries>40) clearInterval(_poll);  // ~20s at 500ms
    }, 500);
  }catch(e){}
})();


window.registerModule('sampler', {
  version: MODULE_VERSION,
  isStub: false
});
console.log('[modules] sampler v' + MODULE_VERSION);
})();
