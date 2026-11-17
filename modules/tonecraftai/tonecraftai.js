/* IMPROVS2 ToneCraftAI — Build 4.9.8.990
 * Prompt-guided TONE3000 model discovery, per-slot DSP parameter proposals and rig snapshots.
 */
(function(){
'use strict';
const VERSION='4.9.8.990';
const state={panel:null,prompt:'',proposal:null,busy:false};
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)));
const FX_RANGES={inputDb:[-24,24],drive:[0,1],outputDb:[-24,24],mix:[0,100],clip:[0,1],lowCut:[20,1000],bassFreq:[40,1000],bass:[0,10],midFreq:[100,8000],midQ:[0.1,10],middle:[0,10],trebleFreq:[1000,12000],treble:[0,10],highCut:[1000,20000]};
function inferTone(prompt){
 const p=String(prompt||'').toLowerCase();
 const has=(...terms)=>terms.some(t=>p.includes(t));
 const tags=[];
 if(has('blues','bloomfield','bb king','freddie king'))tags.push('blues');
 if(has('rock','classic rock','hendrix'))tags.push('classic rock');
 if(has('jazz'))tags.push('jazz');
 if(has('metal','high gain','heavy'))tags.push('high gain');
 if(has('clean','crystal'))tags.push('clean');
 if(has('vintage','warm','woody'))tags.push('vintage warm');
 if(has('fuzz'))tags.push('fuzz');
 if(has('crunch','breakup','break up','gritty'))tags.push('crunch overdrive');
 if(has('tight','palm mute','palm-muted'))tags.push('tight low end');
 if(has('sustain','singing','lead'))tags.push('singing sustain lead');
 if(has('bright','sparkle'))tags.push('bright upper mids');
 if(has('dark','smooth'))tags.push('smooth dark');
 const promptTerms=String(prompt||'').replace(/[\r\n\t]+/g,' ').replace(/[;|]/g,' ').replace(/\s+/g,' ').trim().slice(0,220);
 const clean=has('clean','transparent','chime','edge of breakup');
 const tight=has('tight');
 const highGain=has('metal','high gain','heavy');
 const pedalQuery=has('fuzz')?'fuzz guitar pedal':highGain?'high gain distortion pedal':clean?'clean boost transparent overdrive pedal':'overdrive boost pedal';
 const third=has('stacked','stack','more gain','extra drive','boost','sustain')?{enabled:true,gear:'pedal',query:'overdrive boost sustain '+tags.join(' ')+' '+promptTerms}:{enabled:false,gear:'pedal',query:''};
 const fx={
  R1:{inputDb:clean?-1:1.5,drive:clean?.22:highGain?.68:.48,outputDb:0,mix:100,clip:.05,eqOn:true,lowCut:tight?90:70,bassFreq:120,bass:tight?4.4:5.2,midFreq:has('singing','upper mid')?950:750,midQ:.85,middle:has('singing','upper mid')?6.4:5.8,trebleFreq:3200,treble:has('bright')?6:5.2,highCut:has('dark')?6800:9000},
  R2:{inputDb:0,drive:clean?.28:highGain?.72:.55,outputDb:-1,mix:100,clip:.04,eqOn:true,lowCut:tight?85:65,bassFreq:110,bass:tight?4.5:5.3,midFreq:has('singing','upper mid')?900:700,midQ:.8,middle:has('singing','upper mid')?6.8:5.8,trebleFreq:3300,treble:has('bright')?6.1:5.3,highCut:has('dark')?7000:9500},
  R3:{inputDb:-1,drive:has('fuzz')?.62:.32,outputDb:-2,mix:has('fuzz')?72:55,clip:.08,eqOn:true,lowCut:95,bassFreq:130,bass:4.8,midFreq:1000,midQ:.9,middle:6.2,trebleFreq:3600,treble:5.2,highCut:8200},
  IR1:{inputDb:0,outputDb:-1,mix:100,clip:0,eqOn:true,lowCut:tight?85:70,bassFreq:120,bass:5,midFreq:800,midQ:.8,middle:5.5,trebleFreq:3200,treble:5,highCut:has('dark')?6500:9000}
 };
 return {tags,third,fx,queries:{R1:[pedalQuery,tags.join(' '),promptTerms].filter(Boolean).join(' '),R2:['guitar amplifier',tags.join(' '),promptTerms].filter(Boolean).join(' '),R3:third.query,IR1:['guitar cabinet impulse response',tags.join(' '),promptTerms].filter(Boolean).join(' ')}};
}
function listOf(r){
 if(Array.isArray(r))return r;
 if(!r||typeof r!=='object')return [];
 for(const key of ['data','tones','results','models','items']){
  const value=r[key];
  if(Array.isArray(value))return value;
  if(value&&typeof value==='object'){
   const nested=listOf(value);
   if(nested.length)return nested;
  }
 }
 return [];
}
function pickVariant(models,tier){
 const downloadable=(models||[]).filter(m=>m&&m.id!=null&&typeof m.model_url==='string'&&m.model_url.trim());
 if(!downloadable.length)return null;
 const re=tier==='full'?/A2\s*Full|Full/i:/A2\s*Lite|Lite/i;
 return downloadable.find(m=>re.test(String(m.name||m.title||'')))||downloadable.find(m=>/A2/i.test(String(m.name||'')))||downloadable[0];
}
function compactSearchSeed(slot,query){
 const q=String(query||'').toLowerCase();
 const modelNames=['vox ac30','ac30','twin reverb','deluxe reverb','bassman','jtm45','jcm800','plexi','marshall','fender','mesa boogie','dual rectifier','orange rockerverb','supro','celestion vintage 30','vintage 30','greenback','jensen','blue alnico','g12m'];
 const model=modelNames.find(x=>q.includes(x));
 if(model)return model;
 if(slot==='R1'||slot==='R3'){
  if(/\bfuzz\b/.test(q))return 'fuzz';
  if(/distortion|high gain|metal/.test(q))return 'distortion';
  if(/clean|transparent|chime|boost/.test(q))return 'boost';
  return 'overdrive';
 }
 if(slot==='IR1'){
  const tag=['blues','jazz','rock','metal','clean','vintage'].find(x=>q.includes(x));
  return tag||'cabinet';
 }
 const ampTag=['blues','jazz','metal','clean','classic rock','vintage'].find(x=>q.includes(x));
 return ampTag||'amplifier';
}
async function searchTone(api,slot,query,tier){
 const ir=slot==='IR1',gear=slot==='R1'||slot==='R3'?'pedal':'amp';
 const seed=compactSearchSeed(slot,query);
 const attempts=[{query:seed,sort:'best-match'},{query:'',sort:'trending'}];
 const lookupErrors=[],seen=new Set();let candidateCount=0,firstTone=null,searchErrors=[],attemptsUsed=0;
 for(let attempt=0;attempt<attempts.length;attempt++){
  attemptsUsed=attempt+1;
  const options={gears:ir?'cab':gear,format:ir?'ir':'nam',sort:attempts[attempt].sort,page:1,page_size:25};
  if(attempts[attempt].query)options.query=attempts[attempt].query;
  let tones=[];
  try{
   const res=await api.search(options);
   tones=listOf(res);
  }catch(err){
   const message=err&&err.message||String(err);
   searchErrors.push(message);
   // A broad retry is useful for a rejected query parameter, but not for rate limits/auth failures.
   if(attempt===0&&/(?:400|invalid|validation)/i.test(message))continue;
   break;
  }
  for(const tone of tones){
   if(!tone||tone.id==null||seen.has(String(tone.id)))continue;
   seen.add(String(tone.id));candidateCount++;if(!firstTone)firstTone=tone;
  }
  if(!tones.length)continue;
  for(const tone of tones){
   if(!tone||tone.id==null)continue;
   try{
    const raw=await api.listModels(tone.id),models=listOf(raw),model=pickVariant(models,tier);
    if(model){
     const downloadable=models.filter(m=>m&&m.id!=null&&typeof m.model_url==='string'&&m.model_url.trim());
     return {slot,tone,models:downloadable,model,query,searchQuery:options.query||'',searchAttempts:attempt+1,ir,candidateCount,lookupErrors,searchErrors};
    }
   }catch(err){lookupErrors.push((tone.title||tone.name||('Tone '+tone.id))+': '+(err&&err.message||String(err)));}
  }
  // A non-empty catalogue response means the filters worked. Do not spend another
  // rate-limited search call if those tones simply lack a downloadable A2 variant.
  if(tones.length)break;
 }
 return {slot,tone:firstTone,models:[],model:null,query,searchQuery:'',searchAttempts:attemptsUsed,ir,candidateCount,lookupErrors,searchErrors};
}
function defaultPrompt(){return 'A warm, articulate blues-rock lead. Bloomfield-style sustain, singing upper mids, gritty but controlled breakup, tight bass and excellent note separation.';}
function render(){
 const p=state.panel;if(!p)return;
 p.innerHTML='<div class="tc-head"><strong>✦ TONECRAFT AI</strong><span>BUILD 990 · NAM + IR RIG CRAFTER</span></div>'+
 '<p class="tc-help">Describe the tone. ToneCraft searches your connected TONE3000 library, chooses compatible NAM variants and proposes independent DSP controls for each slot. Nothing loads until you approve it.</p>'+
 '<textarea id="tcPrompt" rows="3" maxlength="1200" placeholder="Describe your guitar tone…">'+esc(state.prompt||defaultPrompt())+'</textarea>'+ 
 '<div class="tc-actions"><label>MODEL TIER <select id="tcTier"><option value="lite">A2 Lite preferred</option><option value="full">A2 Full preferred</option><option value="auto">Automatic</option></select></label><label class="tc-check"><input id="tcUseR3" type="checkbox" '+(state.proposal&&state.proposal.useR3?'checked':'')+'> Add R3 when useful</label><button id="tcGenerate" type="button">GENERATE PROPOSAL</button></div>'+ 
 '<div class="tc-status" id="tcStatus">Connect TONE3000 in RIG, then generate a model and parameter proposal.</div><div id="tcProposal"></div>'+ 
 '<div class="tc-foot">A2 Lite/Full selection is based on the variants returned by TONE3000. DSP controls are per-slot and saved in the rig snapshot. NAM weights themselves are not rewritten.</div>';
 const style=p.ownerDocument.getElementById('tonecraftai-style');if(!style){const st=p.ownerDocument.createElement('style');st.id='tonecraftai-style';st.textContent='#tonecraftaiPanel .tc-head{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}#tonecraftaiPanel .tc-head strong{font-size:20px;color:#c4b5fd}#tonecraftaiPanel .tc-head span,#tonecraftaiPanel .tc-foot{font-size:11px;color:#94a3b8}#tonecraftaiPanel .tc-help{margin:8px 0;color:#cbd5e1;font-size:13px;line-height:1.5}#tonecraftaiPanel textarea{width:100%;max-width:100%;padding:10px;border-radius:7px;background:#080d18;color:#fff;border:1px solid #475569;resize:vertical}#tonecraftaiPanel .tc-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:9px 0}#tonecraftaiPanel .tc-actions label{display:grid;gap:4px;font-size:11px;color:#cbd5e1}#tonecraftaiPanel select,#tonecraftaiPanel button{padding:8px 10px;border-radius:6px;background:#26364b;color:#fff;border:1px solid #64748b}#tonecraftaiPanel #tcGenerate{background:#6d28d9;border-color:#a78bfa;font-weight:900}#tonecraftaiPanel .tc-check{display:flex;align-items:center;gap:6px}#tonecraftaiPanel .tc-status{margin:7px 0;color:#a5b4fc;font-size:12px}#tonecraftaiPanel .tc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:8px;margin-top:9px}#tonecraftaiPanel .tc-card{min-width:0;padding:10px;background:#0b1220;border:1px solid #475569;border-radius:8px}#tonecraftaiPanel .tc-card h4{color:#c4b5fd;margin-bottom:5px}#tonecraftaiPanel .tc-card .tc-model{color:#e5e7eb;font-size:13px;overflow-wrap:anywhere}#tonecraftaiPanel .tc-card .tc-meta{color:#94a3b8;font-size:11px;margin:4px 0}#tonecraftaiPanel .tc-card select{width:100%;margin:6px 0}#tonecraftaiPanel .tc-fx{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:7px 0}#tonecraftaiPanel .tc-fx label{font-size:10px;color:#9fb0c5;min-width:0}#tonecraftaiPanel .tc-fx input{display:block;width:100%;min-width:0;padding:5px;background:#111827;color:#fff;border:1px solid #475569;border-radius:4px}#tonecraftaiPanel .tc-card button{margin-top:6px;width:100%}#tonecraftaiPanel .tc-applyall{margin-top:10px;background:#047857!important;border-color:#34d399!important;font-weight:900;width:100%}#tonecraftaiPanel .tc-foot{margin-top:10px;line-height:1.5}';p.ownerDocument.head.appendChild(st);}
 p.querySelector('#tcGenerate').onclick=generate;
}
async function generate(){
 const p=state.panel,status=p.querySelector('#tcStatus'),out=p.querySelector('#tcProposal'),prompt=p.querySelector('#tcPrompt').value.trim();
 if(!prompt){status.textContent='Enter a tone description first.';return;}
 state.prompt=prompt;status.textContent='Connecting to RIG and checking TONE3000…';out.innerHTML='';
 try{
  await window.loadModule('rig');const api=window.T3K;
  if(!api||!api.connected)throw new Error('TONE3000 search API is unavailable.');
  if(!api.connected()){status.textContent='TONE3000 sign-in required. Opening the existing connection flow…';await api.connect();}
  const tier=p.querySelector('#tcTier').value,plan=inferTone(prompt),useR3=p.querySelector('#tcUseR3').checked||plan.third.enabled;
  status.textContent='Searching TONE3000 for R1, R2'+(useR3?', R3':'')+' and IR1…';
  const jobs=[searchTone(api,'R1',plan.queries.R1,tier),searchTone(api,'R2',plan.queries.R2,tier),searchTone(api,'IR1',plan.queries.IR1,tier)];
  if(useR3)jobs.splice(2,0,searchTone(api,'R3',plan.queries.R3,tier));
  const found=await Promise.all(jobs);state.proposal={prompt,plan,slots:found,useR3,tier};
  renderProposal();
  const ready=found.filter(x=>x.model).length,failed=found.filter(x=>!x.model);
  status.textContent=failed.length
   ?'Partial proposal: '+ready+'/'+found.length+' slots have downloadable models. '+failed.map(x=>x.slot+': '+(x.searchErrors&&x.searchErrors.length?'search failed — '+x.searchErrors[0]:x.lookupErrors&&x.lookupErrors.length?'lookup failed for '+x.lookupErrors.length+' tone(s) — '+x.lookupErrors[0]:'no downloadable variant among '+(x.candidateCount||0)+' tone result(s)')).join(' · ')
   :'Proposal ready: all '+ready+' slots have downloadable models. Review the selections and controls before applying.';
 }catch(e){status.textContent='ToneCraftAI could not complete the search: '+(e.message||e);console.error('[ToneCraftAI]',e);}
}
function renderProposal(){
 const p=state.panel,out=p.querySelector('#tcProposal'),proposal=state.proposal;if(!proposal)return;
 const cards=proposal.slots.map((slot,index)=>{
  const title=slot.slot==='R1'?'R1 · DRIVE / BOOST':slot.slot==='R2'?'R2 · AMPLIFIER':slot.slot==='R3'?'R3 · OPTIONAL ADDITIONAL STAGE':'IR1 · CABINET';
  const fx=proposal.plan.fx[slot.slot],keys=Object.keys(fx);
  const variants=slot.models.map((m,i)=>'<option value="'+i+'" '+(String(m.id)===String(slot.model&&slot.model.id)?'selected':'')+'>'+esc(m.name||('Variant '+(i+1)))+'</option>').join('');
  const lookupNote=slot.searchErrors&&slot.searchErrors.length?'TONE3000 search failed: '+slot.searchErrors.slice(0,2).join(' · '):slot.lookupErrors&&slot.lookupErrors.length?'Model lookup failed for '+slot.lookupErrors.length+' tone result(s): '+slot.lookupErrors.slice(0,2).join(' · '):'No downloadable variant among '+(slot.candidateCount||0)+' tone result(s).';
  return '<article class="tc-card" data-tc-slot="'+slot.slot+'"><h4>'+title+'</h4><div class="tc-model">'+esc(slot.tone&&(slot.tone.title||slot.tone.name)||'No compatible TONE3000 model found')+'</div><div class="tc-meta">'+esc(slot.model&&slot.model.name||'No downloadable variant')+' · '+(slot.ir?'IR':'NAM')+'</div>'+(slot.model?'<label class="tc-meta">MODEL VARIANT<select data-tc-variant>'+variants+'</select></label>':'<div class="tc-meta">'+esc(lookupNote)+'</div>')+
  '<div class="tc-fx">'+keys.map(k=>'<label>'+esc(k)+(k==='eqOn'?'<input type="checkbox" data-tc-fx="eqOn" '+(fx.eqOn?'checked':'')+' style="display:block;width:auto">':'<input type="number" step="0.1" min="'+FX_RANGES[k][0]+'" max="'+FX_RANGES[k][1]+'" data-tc-fx="'+k+'" value="'+esc(fx[k])+'">')+'</label>').join('')+'</div>'+(slot.model?'<button type="button" data-tc-apply="'+index+'">LOAD '+slot.slot+' + APPLY CONTROLS</button>':'')+'</article>';
 }).join('');
 out.innerHTML='<div class="tc-grid">'+cards+'</div><button type="button" class="tc-applyall" id="tcApplyAll">APPLY PROPOSED RIG</button><div class="tc-actions"><label>SAVE SNAPSHOT <select id="tcSnapshot">'+['A','B','C','D','E','F','G'].map((x,i)=>'<option value="'+i+'">'+x+'</option>').join('')+'</select></label><button type="button" id="tcSave">SAVE CURRENT RIG</button></div>';
 out.querySelectorAll('[data-tc-variant]').forEach(sel=>sel.addEventListener('change',()=>{const card=sel.closest('[data-tc-slot]'),slot=proposal.slots.find(x=>x.slot===card.dataset.tcSlot);slot.model=slot.models[Number(sel.value)]||slot.model;}));
 out.querySelectorAll('[data-tc-apply]').forEach(btn=>btn.addEventListener('click',()=>applySlot(proposal.slots[Number(btn.dataset.tcApply)])));
 out.querySelector('#tcApplyAll').onclick=applyAll;
 out.querySelector('#tcSave').onclick=saveSnapshot;
}
function readFx(slot){
 const card=state.panel.querySelector('[data-tc-slot="'+slot.slot+'"]'),out={};
 card.querySelectorAll('[data-tc-fx]').forEach(input=>{const key=input.dataset.tcFx;out[key]=key==='eqOn'?!!input.checked:clamp(input.value,FX_RANGES[key][0],FX_RANGES[key][1]);});return out;
}
async function applySlot(slot){
 if(!slot||!slot.model||!slot.tone)throw new Error('A compatible model variant is required.');
 await window.loadModule('rig');
 const bridge=window.RigSnapshotBridge,nam8=window.NAM8;
 if(!bridge||!nam8||!bridge.loadT3KModel)throw new Error('The eight-slot NAM/IR rig is not ready.');
 const status=state.panel.querySelector('#tcStatus');status.textContent='Loading '+slot.slot+'…';
 await bridge.loadT3KModel(slot.slot,slot.tone,slot.model);
 const fx=readFx(slot);
 if(slot.ir)await nam8.setIRFx(slot.slot,fx);else await nam8.setSlotFx(slot.slot,fx);
 status.textContent=slot.slot+' loaded and its independent DSP controls applied.';
}
async function applyAll(){
 const status=state.panel.querySelector('#tcStatus'),proposal=state.proposal;if(!proposal)return;
 const valid=proposal.slots.filter(x=>x.model&&x.tone);
 if(valid.length<3) {status.textContent='Not enough compatible TONE3000 variants were found. Nothing applied.';return;}
 try{
  for(const slot of valid){await applySlot(slot);}
  status.textContent='Rig proposal applied: '+valid.map(x=>x.slot).join(' → ')+'. Review audio and save a snapshot if satisfied.';
 }catch(e){status.textContent='Rig application stopped at the failing slot: '+(e.message||e);}
}
async function saveSnapshot(){
 const status=state.panel.querySelector('#tcStatus');try{await window.loadModule('rig');const index=Number(state.panel.querySelector('#tcSnapshot').value);await window.RigSnapshotBridge.saveCurrent(index);status.textContent='Current rig saved to snapshot '+String.fromCharCode(65+index)+'.';}catch(e){status.textContent='Snapshot save failed: '+(e.message||e);}
}
function open(panel){state.panel=panel;render();}
window.registerModule('tonecraftai',{version:VERSION,isStub:false,open,close:function(){state.panel=null;},inferTone:inferTone});
})();
