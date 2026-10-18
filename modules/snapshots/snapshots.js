// modules/snapshot/snapshots.js
// version: 4.9.8.886
// A–G snapshot orchestration, random starter rigs, overwrite workflow, and portable export.
(function(){
'use strict';
var VERSION='4.9.8.887', LETTERS='ABCDEFG', FORMAT='IMPROVS2-RIG-SNAPSHOTS';
var GENERATE_INTENT='improvs2_snapshot_randomize_pending';
function el(id){return document.getElementById(id);}
function status(msg){var s=el('rigSnapStat');if(s)s.textContent=msg;try{if(window.RigSnapshotBridge)window.RigSnapshotBridge.setStatus(msg);}catch(e){}}
function rand(arr){return arr[Math.floor(Math.random()*arr.length)];}
function normalizeList(res){
  if(Array.isArray(res)) return res;
  if(res&&Array.isArray(res.data)) return res.data;
  if(res&&Array.isArray(res.tones)) return res.tones;
  if(res&&Array.isArray(res.results)) return res.results;
  return [];
}
function bytesToB64(buffer){var bytes=new Uint8Array(buffer),out='',step=0x8000;for(var i=0;i<bytes.length;i+=step)out+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+step,bytes.length)));return btoa(out);}
function encode(value){
  if(value instanceof Float32Array)return {__t:'f32',d:bytesToB64(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength))};
  if(value instanceof Float64Array)return {__t:'f64',d:bytesToB64(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength))};
  if(value instanceof Int16Array)return {__t:'i16',d:bytesToB64(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength))};
  if(value instanceof Uint8Array)return {__t:'u8',d:bytesToB64(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength))};
  if(value instanceof ArrayBuffer)return {__t:'ab',d:bytesToB64(value)};
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object'){var o={};Object.keys(value).forEach(function(k){o[k]=encode(value[k]);});return o;}
  return value;
}
function downloadJson(payload){var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='improvs2-rig-snapshots-A-G.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1500);}
async function exportAll(){
  if(!window.RigSnapStore||typeof window.RigSnapStore.load!=='function')throw new Error('Snapshot store is not ready yet.');
  var bridge=window.RigSnapshotBridge;
  if(bridge&&bridge.loadFromDisk) await bridge.loadFromDisk();
  var slots=await Promise.all(LETTERS.split('').map(async function(letter,index){var data=await window.RigSnapStore.load(index);if(data==null&&bridge&&bridge.getSnapshotForDisk)data=bridge.getSnapshotForDisk(index);return {letter:letter,index:index,data:data==null?null:encode(data)};}));
  var count=slots.filter(function(s){return s.data!==null;}).length;
  if(!count)throw new Error('No saved snapshots found. Generate or save A–G first.');
  downloadJson({format:FORMAT,schemaVersion:1,appBuild:window.BUILD||'unknown',exportedAt:new Date().toISOString(),slots:slots});
  return count;
}
async function candidates(gear,format){
  var api=window.T3K;if(!api||!api.connected||!api.connected())throw new Error('Connect TONE3000 first.');
  var out=[];
  // Try broad gear-filtered searches; a text fallback handles API versions that require query.
  var queries=[{query:'',gears:gear,format:format,sort:'trending',page:1,page_size:100}];
  if(gear==='amp-cab')queries.push({query:'amp cabinet',gears:'amp-cab',format:format,sort:'trending',page:1,page_size:100});
  else if(gear==='amp')queries.push({query:'amp',gears:'amp',format:format,sort:'trending',page:1,page_size:100});
  else if(gear==='pedal')queries.push({query:'pedal',gears:'pedal',format:format,sort:'trending',page:1,page_size:100});
  else if(gear==='cab')queries.push({query:'cabinet',gears:'cab',format:format,sort:'trending',page:1,page_size:100});
  for(var i=0;i<queries.length;i++){
    try{out=out.concat(normalizeList(await api.search(queries[i])));}catch(e){}
    if(out.length)break;
  }
  var seen={};out=out.filter(function(t){var id=t&&t.id;if(id==null||seen[String(id)])return false;seen[String(id)]=1;return String(t.format||format).toLowerCase()===format;});
  // Preserve the gear category returned by the query. This is essential: amp+cab NAMs
  // already contain a cabinet response and must never be paired with an extra IR.
  out.forEach(function(t){try{t._snapshotGear=gear;}catch(e){}});
  return out;
}
async function chooseModel(tone){
  var r=await window.T3K.listModels(tone.id),models=normalizeList(r).filter(function(m){return m&&m.model_url;});
  if(!models.length)throw new Error('No downloadable NAM variants for '+(tone.title||tone.name||tone.id));
  return rand(models);
}
async function loadRandomSlot(slot, pool, gearLabel){
  if(!pool.length)throw new Error('No TONE3000 '+gearLabel+' candidates were returned.');
  // Up to 8 attempts in case a tone has no compatible/downloadable model.
  var attempts=Math.min(8,pool.length),last;
  while(attempts--){
    var index=Math.floor(Math.random()*pool.length),tone=pool.splice(index,1)[0];
    try{var model=await chooseModel(tone);await window.RigSnapshotBridge.loadT3KModel(slot,tone,model);return {tone:tone,model:model};}
    catch(e){last=e;}
  }
  throw last||new Error('Could not load a random '+gearLabel+' model.');
}
var PEDAL_PRESETS=[
  {letter:'A',query:'Blues Driver Waza Craft',aliases:['blues driver','waza','wazzacraft']},
  {letter:'B',query:'King of Tone',aliases:['king of tone']},
  {letter:'C',query:'ProCo RAT distortion',aliases:['rat','proco rat']},
  {letter:'D',query:'Boss DS-1 distortion',aliases:['ds-1','boss ds','boss distortion']},
  {letter:'E',query:'Ibanez TS9 Tube Screamer',aliases:['ts9','ibanez','tube screamer']},
  {letter:'F',query:'Andy Timmons pedal',aliases:['andy timmons']},
  {letter:'G',query:'Klon Centaur',aliases:['klon centaur','centaur']}
];
async function findNamedPedal(spec){
  var api=window.T3K, queries=[spec.query].concat(spec.aliases||[]), results=[];
  for(var q=0;q<queries.length;q++){
    try{var r=await api.search({query:queries[q],gears:'pedal',format:'nam',sort:'trending',page:1,page_size:100});results=normalizeList(r);if(results.length)break;}catch(e){}
  }
  if(!results.length)throw new Error('TONE3000 search found no pedal for snapshot '+spec.letter+': '+spec.query);
  var terms=(spec.aliases||[spec.query]).map(function(x){return String(x).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);});
  function title(t){return String(t.title||t.name||t.slug||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);}
  var matching=results.filter(function(t){var words=title(t);return terms.some(function(term){for(var j=0;j<=words.length-term.length;j++){var ok=true;for(var k=0;k<term.length;k++)if(words[j+k]!==term[k]){ok=false;break;}if(ok)return true;}return false;});});
  // Prefer a direct title match; if the API's search is fuzzy, never silently pick an unrelated result.
  var tone=matching[0];
  if(!tone)throw new Error('TONE3000 returned results, but none matched '+spec.query+' for snapshot '+spec.letter+'. Check the tone name in TONE3000.');
  return tone;
}
async function generateRandomSnapshots(){
  var bridge=window.RigSnapshotBridge,api=window.T3K;
  if(!bridge)throw new Error('RIG module is not ready yet.');
  if(!api||!api.connected||!api.connected()){
    localStorage.setItem(GENERATE_INTENT,'1');
    if(api&&api.configured&&api.configured()&&api.connect){api.connect().catch(function(e){status('TONE3000 connect failed: '+e.message);});return {pending:true};}
    throw new Error('TONE3000 is not connected/configured.');
  }
  var store=window.RigSnapStore;if(!store||!store.load)throw new Error('Snapshot storage is not ready.');
  if(bridge.loadFromDisk)await bridge.loadFromDisk();
  if(typeof window.confirm==='function'&&!window.confirm('Build the A–G starter set? This replaces all seven saved snapshots. Export your current snapshots first if you want to keep them.'))return {cancelled:true};
  status('Finding your seven specified pedal tones…');
  var ampOnlyPool=await candidates('amp','nam');
  var ampCabPool=await candidates('amp-cab','nam');
  var ampPool=ampOnlyPool.concat(ampCabPool);
  var irPool=[];try{irPool=await candidates('cab','ir');}catch(e){}
  if(!ampPool.length)throw new Error('TONE3000 returned no amp/amp+cabinet NAM candidates.');
  var irLetters=['A','C','E','G'];
  if(!ampOnlyPool.length)throw new Error('No amp-only NAM candidates were returned; an IR must not be combined with an amp+cabinet NAM.');
  if(!irPool.length)throw new Error('No IR candidates were returned, so the four IR snapshots cannot be built safely.');
  var completed=[];
  for(var i=0;i<PEDAL_PRESETS.length;i++){
    var spec=PEDAL_PRESETS[i],idx=i;
    status('Building snapshot '+spec.letter+': '+spec.query+' ('+(i+1)+'/7)…');
    var pedalTone=await findNamedPedal(spec), pedalModel=await chooseModel(pedalTone);
    await bridge.loadT3KModel('pedal',pedalTone,pedalModel);
    var useIR=irLetters.indexOf(spec.letter)!==-1;
    // A/C/E/G deliberately use amp-only NAMs so their additional IR is valid.
    // B/D/F may use either an amp-only or an amp+cabinet NAM and never get an extra IR.
    var ampChoice=await loadRandomSlot('amp',useIR?ampOnlyPool:ampPool,'amp/amp+cabinet');
    bridge.clearIR();
    if(useIR){await loadRandomSlot('cab',irPool,'IR');}
    await bridge.saveCurrent(idx);
    completed.push(spec.letter);
  }
  localStorage.removeItem(GENERATE_INTENT);
  status('Built A–G. A/C/E/G use amp-only NAMs plus an IR; B/D/F use a random amp-only or amp+cabinet NAM without an extra IR. Tweak a rig, then SAVE and tap its letter to overwrite it.');
  return {filled:completed.length,letters:completed};
}
function bind(){
  var exportBtn=el('rigSnapExportJson'),randomBtn=el('rigSnapRandomize');
  if(exportBtn&&!exportBtn.__snapshotBound){exportBtn.__snapshotBound=true;exportBtn.addEventListener('click',async function(){var old=exportBtn.textContent;exportBtn.disabled=true;exportBtn.textContent='EXPORTING…';try{var n=await exportAll();status('Exported '+n+'/7 snapshots');}catch(e){status(e.message||'Snapshot export failed');console.warn('[snapshot export]',e);}finally{exportBtn.disabled=false;exportBtn.textContent=old;}});}
  if(randomBtn&&!randomBtn.__snapshotBound){randomBtn.__snapshotBound=true;randomBtn.addEventListener('click',async function(){var old=randomBtn.textContent;randomBtn.disabled=true;randomBtn.textContent='BUILDING…';try{var r=await generateRandomSnapshots();if(r.pending)status('Connect to TONE3000; starter snapshots will generate after returning.');else if(r.cancelled)status('Starter generation cancelled; snapshots unchanged.');}catch(e){status(e.message||'Random snapshot generation failed');console.warn('[snapshot randomize]',e);}finally{randomBtn.disabled=false;randomBtn.textContent=old;}});}
}
function init(){bind();
  // Resume a user-requested generation after the TONE3000 OAuth redirect, never overwrite filled slots.
  if(localStorage.getItem(GENERATE_INTENT)==='1'){
    var tries=0;var timer=setInterval(function(){tries++;if(window.T3K&&window.T3K.connected&&window.T3K.connected()&&window.RigSnapshotBridge){clearInterval(timer);generateRandomSnapshots().catch(function(e){status(e.message||'Random generation failed');console.warn('[snapshot randomize]',e);});}
      else if(tries>=120)clearInterval(timer);},1000);
  }
}
window.SnapshotsModule={version:VERSION,exportAll:exportAll,generateRandomSnapshots:generateRandomSnapshots};
window.registerModule('snapshot',{version:VERSION,isStub:false,exportAll:exportAll,generateRandomSnapshots:generateRandomSnapshots});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
console.log('[modules] snapshot v'+VERSION);
})();
