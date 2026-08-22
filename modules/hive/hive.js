// modules/hive/hive.js
// version: 4.9.8.860
// §HIVE + §LOTUS — colour lattice, geodesic sphere, lotus rosette, 4D, POV
// Extracted from app-860 lineage. Depends on window.SCALE_SIGS (shell).
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';

const ScaleHive = (function(){
  const G = (typeof window!=='undefined')?window:globalThis;
  let canvas, ctx, cells=[], yaw=0.6, pitch=-0.35, spinning=true, raf=null;
  let dragging=false, lastX=0, lastY=0, moved=0;
  let screenPts=[];   // projected positions for tap hit-testing

  // §HIVE ── colour-lattice visualiser: cells, geodesic sphere, lotus rosette
  function buildCells(limit){
    // dedupe SCALE_SIGS by signature colour, take a spread up to `limit`
    const seen=new Map();
    for(const sig of (G.SCALE_SIGS||[])){
      if(sig.r==null) continue;
      const k=Math.round(sig.r/6)+'_'+Math.round(sig.g/6)+'_'+Math.round(sig.b/6);
      if(!seen.has(k)) seen.set(k,sig);
    }
    let all=[...seen.values()];
    if(!all.length){ cells=[]; return false; }   // data not ready yet
    if(all.length>limit){
      const step=all.length/limit, out=[];
      for(let i=0;i<all.length;i+=step) out.push(all[Math.floor(i)]);
      all=out;
    }
    const mean=[0,1,2].map(ch=>all.reduce((s,c)=>s+[c.r,c.g,c.b][ch],0)/all.length);
    // Ring brightness per cell (sum of semitone distances from root), normalised across the set
    const brOf=c=>(c.semis||[]).reduce((a,s)=>a+(((s%12)+12)%12),0);
    let bmin=Infinity,bmax=-Infinity; all.forEach(c=>{const b=brOf(c); if(b<bmin)bmin=b; if(b>bmax)bmax=b;});
    const span=(bmax-bmin)||1;
    cells=all.map(c=>({sig:c, p:[c.r-mean[0], c.g-mean[1], c.b-mean[2]],
      yr:c.r, yg:c.g, yb:c.b,                       // YOUR colour channels
      bright:(brOf(c)-bmin)/span,                   // 0..1 Ring brightness
      hex:c.mixHex||'#888'}));
    recolour();
    layoutLattice();
    return true;
  }
  // Two INDEPENDENT dials (your intuition: 64 & 46, separate axes):
  //  myColourPct  = how strongly YOUR perceptual colour shows (vs neutral)
  //  ringBrightPct = how strongly Ring's structural brightness modulates lightness
  let myColourPct=64, ringBrightPct=46;
  function recolour(){
    const mc=myColourPct/100, rb=ringBrightPct/100;
    for(const c of cells){
      // your colour at strength mc (fades toward mid-grey as mc drops)
      let r=c.yr*mc+128*(1-mc), g=c.yg*mc+128*(1-mc), b=c.yb*mc+128*(1-mc);
      // Ring brightness pulls lightness toward its structural target, at strength rb
      const target=c.bright*255;
      r=r*(1-rb)+target*rb; g=g*(1-rb)+target*rb; b=b*(1-rb)+target*rb;
      c.hex='#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
    }
  }

  function project(p0){
    const p = (latticeMode && p0.lp) ? p0.lp : (p0.p||p0);
    const cy=Math.cos(yaw), sy=Math.sin(yaw);
    let x=p[0]*cy - p[2]*sy, z=p[0]*sy + p[2]*cy, y=p[1];
    const cx=Math.cos(pitch), sx=Math.sin(pitch);
    let y2=y*cx - z*sx, z2=y*sx + z*cx;
    const persp=520/(520 + z2*1.1);
    const W=(canvas._cssW||canvas.width), H=(canvas._cssH||canvas.height);
    return { sx: W/2 + x*1.55*persp*zoom, sy: H/2 + y2*1.55*persp*zoom, depth: z2, scale: persp };
  }

  function hexPath(cx,cy,r){
    ctx.beginPath();
    for(let k=0;k<6;k++){ const a=Math.PI/180*(60*k+30); const px=cx+r*Math.cos(a), py=cy+r*Math.sin(a); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }
    ctx.closePath();
  }

  // Position cells on hexagonal lattice RINGS by Ring brightness (centre=low, outward=high).
  // The cloud's own outline then forms the giant hexagon.
  let latticeMode=true, maxRing=0;
  // ── HIVE MODE: hexatonic-only honeycomb, bee POV, key-anchored home, forage walk ──
  let hiveMode=false, hiveCells=[], beeAt=-1, homeIdx=-1, foragePath=[], foraging=false, forageTimer=null;
  let hiveComb=[], combPanX=0, combPanY=0;
  function pop12(n){let c=0;for(let i=0;i<12;i++)if(n&(1<<i))c++;return c;}
  function pcsId(pcs){let n=0;for(const p of pcs)n|=(1<<(((p%12)+12)%12));return n;}
  // build hexatonic comb anchored to current key root
  function buildHive(){
    const root = (G.getHiveRoot? G.getHiveRoot() : 0);
    // ENUMERATE all 462 rooted hexatonics (root + 5 of the other 11 semitones) — dense Cerebro field
    const others=[1,2,3,4,5,6,7,8,9,10,11];
    function* combos(a,k,s=0,acc=[]){ if(acc.length===k){ yield acc.slice(); return; } for(let i=s;i<a.length;i++){ acc.push(a[i]); yield* combos(a,k,i+1,acc); acc.pop(); } }
    const sigByKey=new Map();
    // map ABSOLUTE pitch-set -> best (named-preferred) sig, so a cell is named by its OWN
    // natural key, not the fixed current root. Built from every key's signatures.
    const absMap=new Map();
    for(const sig of (G.SCALE_SIGS||[])){
      if(!sig.semis||sig.semis.length!==6) continue;
      let m=0; for(const s of sig.semis) m|=(1<<((((sig.root||0)+s)%12+12)%12));
      const cur=absMap.get(m);
      if(!cur || (sig.name && !cur.name)) absMap.set(m, sig);
    }
    // canonical root for an absolute set (smallest Ring-id rotation) — gives unnamed cells a varied key
    function canonRoot(absM){
      const notes=[]; for(let i=0;i<12;i++) if(absM&(1<<i)) notes.push(i);
      let bestRoot=notes[0]||0, bestId=Infinity;
      for(const r of notes){ let id=0; for(const n of notes) id|=(1<<(((n-r)%12+12)%12)); if(id<bestId){bestId=id;bestRoot=r;} }
      return bestRoot;
    }
    hiveCells=[];
    for(const pick of combos(others,5)){
      const semis=[0,...pick];
      const id=pcsId(semis);
      let absM=0; for(const s of semis) absM|=(1<<(((root+s)%12+12)%12));
      const known=absMap.get(absM);
      let sig;
      if(known){ sig=known; }                                  // real named scale at its own key
      else { const cr=canonRoot(absM);
        const rel=[]; for(let i=0;i<12;i++) if(absM&(1<<i)) rel.push((((i-cr)%12)+12)%12);
        rel.sort((a,b)=>a-b);
        sig={semis:rel, root:cr, keyName:G.NOTES[cr], name:null};  // varied canonical key
      }
      const col = (known && known.mixHex) ? known.mixHex : myColourHex(semis,root);
      hiveCells.push({ id, semis, root, sig, hex: col, nb:[], nbSemi:[] });
    }
    // MUSICAL NEIGHBOURS = single-semitone voice-leading moves:
    // share exactly 5 notes AND the swapped note slides by ONE semitone (the smooth move).
    // These are the ~5.5 truly-resolving neighbours; the FCC lattice's 12 slots can hold them all.
    for(let i=0;i<hiveCells.length;i++){
      const moves=[], other=[];   // single-semitone voice-leadings vs other share-5
      const root=hiveCells[i].root||0;
      for(let j=0;j<hiveCells.length;j++){
        if(i===j) continue;
        if(pop12(hiveCells[i].id & hiveCells[j].id)!==5) continue;
        const onlyA=hiveCells[i].id & ~hiveCells[j].id;   // note that leaves (single bit)
        const onlyB=hiveCells[j].id & ~hiveCells[i].id;   // note that arrives (single bit)
        const pa=Math.round(Math.log2(onlyA)), pb=Math.round(Math.log2(onlyB));
        const upStep=(pb-pa+12)%12, dnStep=(pa-pb+12)%12;
        const d=Math.min(upStep,dnStep);                  // circular semitone distance
        if(d===1){ const dir=(upStep===1)?1:-1;           // +1 = note slid up, -1 = slid down
          const deg=((pa-root)%12+12)%12;                 // which scale degree moves (from root)
          moves.push({j,deg,dir,pa,pb}); }
        else other.push(j);
      }
      const c0=hiveCells[i];
      // ORDER the 1-note neighbours: by the moving degree (chromatic, up from the root),
      // then ascending move (note slid up) before descending — a logical voice-leading order.
      moves.sort((A,B)=> (A.deg-B.deg) || (B.dir-A.dir) || (A.pb-B.pb));
      other.sort((a,b)=>hexColDist(c0.hex,hiveCells[a].hex)-hexColDist(c0.hex,hiveCells[b].hex));
      hiveCells[i].nbSemi = moves.map(m=>m.j);            // ordered smooth voice-leadings
      hiveCells[i].nbMoves = moves;                       // {j,deg,dir} for labelling the order
      hiveCells[i].nb = hiveCells[i].nbSemi.concat(other).slice(0,12);
    }
    const triadMinor=(1<<0)|(1<<3)|(1<<7), triadMajor=(1<<0)|(1<<4)|(1<<7);
    let best=-1,bestScore=1e9;
    hiveCells.forEach((c,idx)=>{
      const hasM=(c.id&triadMinor)===triadMinor, hasMaj=(c.id&triadMajor)===triadMajor;
      if(!hasM&&!hasMaj) return;
      const score=pop12(c.id ^ ((1<<0)|(1<<3)|(1<<5)|(1<<7)|(1<<10)|(1<<2)));
      if(score<bestScore){ bestScore=score; best=idx; }
    });
    homeIdx=best>=0?best:0; beeAt=homeIdx;
    buildSphereLayout();
  }
  // FLAT HONEYCOMB: grow outward from home seed, each cell takes a free adjacent hex slot.
  // Gapless, every cell placed, each touches its 6 nearest true neighbours where slots allow.
  const HEX_DIRS=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  function buildCombLayout(){
    const N=hiveCells.length; if(!N) return;
    hiveComb=new Array(N).fill(null);          // [q,r] axial per cell
    const occ=new Map();                        // 'q,r' -> idx
    const K=(q,r)=>q+','+r;
    const start=homeIdx>=0?homeIdx:0;
    hiveComb[start]=[0,0]; occ.set(K(0,0),start);
    const queue=[start], seen=new Set([start]);
    while(queue.length){
      const cur=queue.shift(); const [q,r]=hiveComb[cur];
      // place this cell's 6 nearest neighbours into its 6 surrounding slots (in order)
      const nbs=hiveCells[cur].nb;
      for(let d=0; d<HEX_DIRS.length; d++){
        const nb=nbs[d]; if(nb==null || hiveComb[nb]) continue;
        // try the matching direction slot first, then any free slot around cur
        let put=null;
        const pref=HEX_DIRS[d], pq=q+pref[0], pr=r+pref[1];
        if(!occ.has(K(pq,pr))) put=[pq,pr];
        else { for(const [dq,dr] of HEX_DIRS){ const nq=q+dq,nr=r+dr; if(!occ.has(K(nq,nr))){ put=[nq,nr]; break; } } }
        if(put){ hiveComb[nb]=put; occ.set(K(put[0],put[1]),nb); if(!seen.has(nb)){seen.add(nb);queue.push(nb);} }
      }
    }
    // any cell still unplaced (its neighbours' slots were all full): spiral-fill nearest free ring
    let ring=1;
    for(let i=0;i<N;i++){ if(hiveComb[i]) continue;
      let put=null;
      while(!put){ // walk outward rings until a free slot
        for(let q=-ring;q<=ring && !put;q++) for(let r=-ring;r<=ring && !put;r++){
          if(Math.max(Math.abs(q),Math.abs(r),Math.abs(-q-r))!==ring) continue;
          if(!occ.has(K(q,r))) put=[q,r];
        }
        ring++; if(ring>60) break;
      }
      if(put){ hiveComb[i]=put; occ.set(K(put[0],put[1]),i); }
      else hiveComb[i]=[0,0];
    }
  }
  function hexName(semis){ return 'Hexatonic'; }
  function myColourHex(semis,root){
    // your colour function: blend the note colours (HEX_MAP via SEMI_COLOR), root weighted
    const RGB=(G.HEX_RGB||null);
    if(!RGB){ return '#caa472'; }
    let r=0,g=0,b=0,w=0;
    semis.forEach((s,i)=>{ const pc=(((root+s)%12)+12)%12; const wt=(i===0)?1.063:1; r+=RGB[pc][0]*wt; g+=RGB[pc][1]*wt; b+=RGB[pc][2]*wt; w+=wt; });
    return '#'+[r/w,g/w,b/w].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  }
  function hexColDist(h1,h2){
    const a=parseInt(h1.slice(1),16),b=parseInt(h2.slice(1),16);
    const r1=(a>>16)&255,g1=(a>>8)&255,b1=a&255, r2=(b>>16)&255,g2=(b>>8)&255,b2=b&255;
    return Math.hypot(r1-r2,g1-g2,b1-b2);
  }
  // forage: leave home, wander 5-12 hops, resolve back home
  function setForageLabel(){
    const b=document.getElementById('hiveForage'); if(!b) return;
    b.style.background = foraging ? '#fde047' : '#000';   // yellow when ON, black when OFF
    b.style.color      = foraging ? '#000'    : '#fbbf24';
  }
  function stopForage(){
    foraging=false; clearInterval(forageTimer); forageTimer=null;
    setForageLabel(); draw();
  }
  function startForage(){
    if(foraging){ stopForage(); return; }              // pressing again stops it
    if(!hiveCells.length) return;
    const len = 5+Math.floor(Math.random()*8);     // 5..12 hops
    foragePath=[homeIdx]; let cur=homeIdx, visited=new Set([homeIdx]);
    for(let h=0;h<len-1;h++){
      const opts=hiveCells[cur].nb.filter(n=>!visited.has(n));
      if(!opts.length) break;
      cur=opts[Math.floor(Math.random()*opts.length)]; visited.add(cur); foragePath.push(cur);
    }
    foragePath.push(homeIdx);     // resolve home
    foraging=true; setForageLabel(); let step=0;
    clearInterval(forageTimer);
    forageTimer=setInterval(()=>{
      if(!foraging || step>=foragePath.length){ stopForage(); return; }
      beeAt=foragePath[step]; faceCell(beeAt); loadHiveCell(beeAt); step++; draw();
    }, 1400);
  }
  function loadPovScale(i){
    const sc=povScales[i]; if(!sc) return;
    const inst=G.INST[G.getActivePrefix()];
    // v751: same setScale(key, mode, alt) fix as loadHiveCell
    if(inst && G.MODE_SEMITONES){
      const keyName=(sc.sig&&sc.sig.keyName) || G.NOTES[sc.root!=null?sc.root:0] || 'C';
      const semis=sc.semis.slice();
      G.MODE_SEMITONES['COLOUR']=semis;
      try{ if(typeof G.MODE_INT_NAMES!=='undefined' && G.CI_INT)
            G.MODE_INT_NAMES['COLOUR']=semis.map(x=>G.CI_INT[((x%12)+12)%12]); }catch(e){}
      try{ inst.setScale(keyName, 'COLOUR', 'NA'); }catch(e){}
    }
    const info=document.getElementById('hiveInfo');
    if(info){ const rid=G.ringId(sc.semis.map(x=>(((x)%12)+12)%12));
      info.textContent='👁 '+(((sc.sig&&sc.sig.keyName)||G.NOTES[sc.root||0])+' '+((sc.sig&&sc.sig.name)||''))+' · '+sc.semis.length+' notes · Ring '+G.ringIdStr(rid); }
  }
  function loadHiveCell(i){
    const c=hiveCells[i]; if(!c) return;
    const inst=G.INST[G.getActivePrefix()];
    // v751: setScale(key, mode, alt) — was setScale('COLOUR', rootNum) so key was invalid,
    //   mode fell through to IONIAN and every hive tap opened as a 7-note major scale.
    if(inst && G.MODE_SEMITONES && c.sig){
      const keyName=c.sig.keyName || G.NOTES[(c.sig.root!=null?c.sig.root:0)] || 'C';
      const semis=(c.sig.semis||c.semis||[]).slice();
      G.MODE_SEMITONES['COLOUR']=semis;
      try{ if(typeof G.MODE_INT_NAMES!=='undefined' && G.CI_INT)
            G.MODE_INT_NAMES['COLOUR']=semis.map(x=>G.CI_INT[((x%12)+12)%12]); }catch(e){}
      try{ inst.setScale(keyName, 'COLOUR', 'NA'); }catch(e){}
    }
    const rid=G.ringId((c.sig.semis||[]).map(x=>(((x)%12)+12)%12));
    const nNotes=(c.sig.semis||c.semis||[]).length;
    document.getElementById('hiveInfo').textContent='🐝 '+((c.sig.keyName||G.NOTES[c.sig.root||0])+' '+(c.sig.name||''))+' · '+nNotes+' notes · Ring '+G.ringIdStr(rid);
  }
  function layoutLattice(){
    if(!cells.length) return;
    // SPIRAL TERRACE (sugarbag-comb form): order cells by a neighbour-walk from the
    // brightest origin, then place them on a golden-angle spiral winding outward.
    // Build a share-colour adjacency so the walk threads true neighbours.
    const N=cells.length;
    // origin = lowest brightness (π-boosted sovereign tonic)
    let origin=0; for(let i=1;i<N;i++) if(cells[i].bright<cells[origin].bright) origin=i;
    // greedy nearest-colour walk to order the terrace (each step ~closest unused colour)
    const used=new Uint8Array(N), order=[origin]; used[origin]=1;
    let cur=origin;
    for(let step=1; step<N; step++){
      let best=-1, bestD=Infinity;
      const c0=cells[cur];
      for(let j=0;j<N;j++){ if(used[j]) continue;
        const c=cells[j]; const d=(c.yr-c0.yr)**2+(c.yg-c0.yg)**2+(c.yb-c0.yb)**2;
        if(d<bestD){ bestD=d; best=j; } }
      if(best<0) break; used[best]=1; order.push(best); cur=best;
    }
    // place on golden-angle spiral: r grows as sqrt(index) (equal-area terrace, no gaps)
    const GA=Math.PI*(3-Math.sqrt(5));   // 137.5° — phyllotaxis
    const SP=15;                          // spacing constant
    order.forEach((ci,n)=>{
      const c=cells[ci];
      const rad=SP*Math.sqrt(n);
      const ang=n*GA;
      // slight terrace climb (z) per turn — the spiral steps up like the bee comb
      c.lp=[rad*Math.cos(ang), rad*Math.sin(ang), (n/N)*40-20];
    });
    maxRing=Math.ceil(Math.sqrt(N));
  }
  let zoom=1;
  // §LOTUS ── LOTUS ROSETTE: flat 12-fold rosette layout. Cells placed on concentric rings with
  //    12-fold symmetry and a cos(12θ) petal modulation → 12 lobes, like a rose window.
  //    Colour flows outward in bands (same nearest-colour walk as the lattice). Flat/top-down.
  let lotusMode=false, lotusMaxRing=0; const LOTUS_SP=16, LOTUS_PETALS=12;
  let lotus4D=false, lotusPhase=0;     // 4D lift: ZW/XW double rotation, projected 4D→3D→2D
  // ── walk ordering for the rosette ──────────────────────────────────────────
  //   'colour' = nearest-RGB neighbour  (flat lotus: colour flows outward in bands)
  //   'note'   = 1-note voice-leading walk — consecutive scales differ by the FEWEST
  //              pitch classes (lotus4D gets its own walk through note-space).
  //   A walk is a 1-D chain: only the two walk-adjacent cells are guaranteed neighbours.
  //   "Surrounded on every side" by 1-note neighbours would need a 2-D Tonnetz embedding,
  //   and not every scale even has a 1-note neighbour here (the colour-isolated singletons),
  //   so where the chain can't step by one note the greedy walk takes the smallest jump.
  function pcMask(c){ let m=0; const s=(c.sig&&c.sig.semis)||[]; for(let k=0;k<s.length;k++) m|=1<<(((s[k]%12)+12)%12); return m; }
  function popc(x){ let n=0; while(x){ x&=x-1; n++; } return n; }
  function walkOrder(mode){
    const N=cells.length; if(!N) return [];
    const masks=cells.map(pcMask);                          // pitch-class sets (note-walk + the diagnostic below)
    // ── ORIGIN ────────────────────────────────────────────────────────────────
    //   colour walk : darkest (tonic) cell.
    //   note  walk : the "TRUEST KEY" — the chromatic minus ONE power chord (C#5 = C# + its
    //     fifth G#). That leaves the 10-note set {C D Eb E F F# G A Bb B}, exactly
    //     C Lydian ∪ Ionian ∪ Mixolydian ∪ Dorian. The two absences are the m2 (C#) and the
    //     m6 (G#). No cell holds all 10 (scales are 5–8 notes), so anchor on the cell sitting
    //     most completely INSIDE it: fewest notes outside the truest key, then the largest scale.
    let origin=0;
    if(mode==='note'){
      const TRUE_KEY=3837, OUT=(~3837)&0xFFF;               // 0b111011111101 ; OUT = the C# & G# bits
      let bestOut=Infinity, bestSize=-1;
      for(let i=0;i<N;i++){ const out=popc(masks[i]&OUT), sz=popc(masks[i]);
        if(out<bestOut || (out===bestOut && sz>bestSize)){ bestOut=out; bestSize=sz; origin=i; } }
      try{ console.log('[LOTUS] truest-key anchor: '+cellLabel(cells[origin])+' — '+bestSize+' notes, '+bestOut+' outside the truest key'); }catch(e){}
    } else {
      for(let i=1;i<N;i++) if(cells[i].bright<cells[origin].bright) origin=i;
    }
    const used=new Uint8Array(N), order=[origin]; used[origin]=1; let cur=origin;
    for(let step=1; step<N; step++){
      let best=-1, bestD=Infinity; const c0=cells[cur];
      for(let j=0;j<N;j++){ if(used[j]) continue;
        let d;
        if(mode==='note'){ d=popc(masks[cur]^masks[j]); }                       // pitch-class symmetric difference
        else { const c=cells[j]; d=(c.yr-c0.yr)**2+(c.yg-c0.yg)**2+(c.yb-c0.yb)**2; }
        if(d<bestD){ bestD=d; best=j; } }
      if(best<0) break;
      used[best]=1; order.push(best); cur=best;
    }
    // diagnostic: how many CONSECUTIVE cells in this walk are genuinely 1-note neighbours
    //   (≤2 pitch classes differ). Works for the colour walk too — so you can see how often
    //   "same colour" actually coincides with "one note apart".
    let oneNote=0; for(let k=1;k<order.length;k++) if(popc(masks[order[k-1]]^masks[order[k]])<=2) oneNote++;
    try{ console.log('[LOTUS] '+(mode==='note'?'note':'colour')+'-walk: '+oneNote+'/'+(order.length-1)+' steps are 1-note moves ('+Math.round(100*oneNote/Math.max(1,order.length-1))+'%)'); }catch(e){}
    return order;
  }
  function layoutRosette(walkMode){
    if(!cells.length) return;
    const order=walkOrder(walkMode||'colour');
    let n=0, ring=0;
    if(order.length){ cells[order[0]].rp=[0,0]; cells[order[0]].rRing=0; n=1; ring=1; }
    while(n<order.length){
      const count=Math.min(order.length-n, LOTUS_PETALS*ring);   // 12·ring cells per ring
      for(let i=0;i<count;i++){
        const c=cells[order[n]];
        const ang=(2*Math.PI/count)*i + (ring%2)*(Math.PI/count);      // stagger alternate rings
        const petal=1 + 0.13*Math.cos(LOTUS_PETALS*ang);              // 12 lobes (the lotus)
        const rad=LOTUS_SP*ring*petal;
        c.rp=[rad*Math.cos(ang), rad*Math.sin(ang)]; c.rRing=ring; n++;
      }
      ring++;
    }
    lotusMaxRing=ring;
    // 4D lift: normalise the flat rosette to ~unit, then give each cell z (dome by ring) and
    //   w (a petal-driven wave into the 4th dimension, stronger at the rim). 4D rotation later
    //   swaps these axes, so the petals fold through a dimension we can't directly see.
    const maxLR=(LOTUS_SP*lotusMaxRing)||1;
    cells.forEach(c=>{ if(!c.rp) return;
      const nx=c.rp[0]/maxLR, ny=c.rp[1]/maxLR;
      const rho=Math.hypot(nx,ny), th=Math.atan2(ny,nx);
      const z0=(0.5-rho)*0.6;                                   // centre forward, rim back (dome)
      const w0=0.5*Math.sin(LOTUS_PETALS*th)*0.7*(0.3+rho);     // 12-petal wave into W
      c.v4=[nx,ny,z0,w0];
    });
  }
  function drawHiveLotus(){
    const W=(canvas._cssW||canvas.width),H=(canvas._cssH||canvas.height),cx=W/2,cy=H/2;
    ctx.clearRect(0,0,W,H);
    const g=ctx.createRadialGradient(cx,cy,4,cx,cy,Math.max(W,H)*0.6);
    g.addColorStop(0,'#0b1d1a'); g.addColorStop(1,'#02080a'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    if(!cells.length){ ctx.fillStyle='#f9a8d4';ctx.font='13px Bangers';ctx.textAlign='center';ctx.fillText('loading…',cx,cy); return; }
    if(lotus4D){ drawLotus4D(W,H,cx,cy); return; }
    const maxR=(LOTUS_SP*lotusMaxRing*1.15)||1;
    const fit=(Math.min(W,H)*0.46/maxR)*zoom;
    // 12 overlapping guide-circles backdrop — the rosette geometry
    ctx.save(); ctx.translate(cx,cy);
    const Rg=LOTUS_SP*lotusMaxRing*0.5*fit;
    ctx.lineWidth=1;
    for(let k=0;k<LOTUS_PETALS;k++){ const a=(2*Math.PI/LOTUS_PETALS)*k; ctx.beginPath();
      ctx.arc(Rg*Math.cos(a),Rg*Math.sin(a),Rg,0,7); ctx.strokeStyle='rgba(94,234,212,0.08)'; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0,0,Rg,0,7); ctx.strokeStyle='rgba(212,175,55,0.10)'; ctx.stroke();
    ctx.restore();
    // cells, inner rings first so outer petals layer on top
    const cellR=Math.max(3,(LOTUS_SP*fit)*0.46);
    const list=cells.map((c,i)=>({i,c})).filter(o=>o.c.rp);
    list.sort((a,b)=>(a.c.rRing||0)-(b.c.rRing||0));
    screenPts=new Array(cells.length);
    for(const o of list){
      const c=o.c, sx=cx+c.rp[0]*fit, sy=cy+c.rp[1]*fit;
      screenPts[o.i]={x:sx,y:sy,r:cellR};
      ctx.beginPath(); ctx.arc(sx,sy,cellR,0,7);
      ctx.fillStyle=c.hex; ctx.globalAlpha=0.94; ctx.fill(); ctx.globalAlpha=1;
      if(o.i===selected){ ctx.lineWidth=2.5; ctx.strokeStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0; }
      else { ctx.lineWidth=0.7; ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.stroke(); }
      if(cellR>=11){ const nm=cellLabel(c); ctx.fillStyle=pickTextColour(c.hex); ctx.font=Math.round(cellR*0.42)+'px Bangers';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(nm,sx,sy); ctx.textBaseline='alphabetic'; }
    }
    if(selected>=0 && screenPts[selected]){ const sp=screenPts[selected]; ctx.beginPath(); ctx.arc(sp.x,sp.y,sp.r+6,0,7); ctx.strokeStyle='#5eead4'; ctx.lineWidth=2; ctx.stroke(); }
    ctx.fillStyle='#f9a8d4'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.fillText('✿ lotus · '+cells.length+' scales · tap a petal-cell', 6, 14);
  }
  function drawLotus4D(W,H,cx,cy){
    // Two simultaneous 4D rotations at different rates (ZW + XW planes) → isoclinic-ish motion
    //   with no 3D analogue: the petals turn through W and appear to fold inside-out.
    const beta=lotusPhase, gamma=lotusPhase*0.62;
    const cb=Math.cos(beta),sb=Math.sin(beta), cg=Math.cos(gamma),sg=Math.sin(gamma);
    const cyaw=Math.cos(yaw),syaw=Math.sin(yaw), cpit=Math.cos(pitch),spit=Math.sin(pitch);
    const fit=Math.min(W,H)*0.40*zoom, D4=2.4, D3=3.0;
    const list=[];
    for(let i=0;i<cells.length;i++){ const c=cells[i]; if(!c.v4) continue;
      let [x,y,z,w]=c.v4;
      let z1=z*cb - w*sb, w1=z*sb + w*cb;            // ZW-plane rotation (pure 4D)
      let x1=x*cg - w1*sg, w2=x*sg + w1*cg;          // XW-plane rotation (pure 4D)
      const s4=D4/(D4 - w2);                          // 4D→3D perspective from the W axis
      let X=x1*s4, Y=y*s4, Z=z1*s4;
      let xa=X*cyaw - Z*syaw, za=X*syaw + Z*cyaw;     // drag: yaw about Y
      let yb=Y*cpit - za*spit, zb=Y*spit + za*cpit;   //       pitch about X
      const s3=D3/(D3 - zb);                          // 3D→2D perspective
      const sx=cx + xa*fit*s3, sy=cy + yb*fit*s3;
      const rad=Math.max(2,(fit/lotusMaxRing)*0.5*s4*s3);
      list.push({i,sx,sy,rad,depth:zb,s:s4*s3});
    }
    list.sort((a,b)=>a.depth-b.depth);                // painter's: far (low z) first
    screenPts=new Array(cells.length);
    for(const o of list){
      const c=cells[o.i];
      screenPts[o.i]={x:o.sx,y:o.sy,r:o.rad};
      ctx.beginPath(); ctx.arc(o.sx,o.sy,o.rad,0,7);
      ctx.fillStyle=c.hex; ctx.globalAlpha=Math.max(0.35,Math.min(1,o.s*0.85)); ctx.fill(); ctx.globalAlpha=1;
      if(o.i===selected){ ctx.lineWidth=2.5; ctx.strokeStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0; }
      else { ctx.lineWidth=0.6; ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.stroke(); }
      if(o.rad>=11){ const nm=cellLabel(c); ctx.fillStyle=pickTextColour(c.hex); ctx.font=Math.round(o.rad*0.45)+'px Bangers';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.globalAlpha=Math.max(0.5,Math.min(1,o.s*0.85)); ctx.fillText(nm,o.sx,o.sy); ctx.globalAlpha=1; ctx.textBaseline='alphabetic'; }
    }
    ctx.fillStyle='#f9a8d4'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.fillText('✦ 4D lotus · folding through W · drag to turn · tap a cell', 6, 14);
  }

  function draw(){
    if(!ctx) return;
    if(lotusMode){ drawHiveLotus(); return; }
    if(hiveMode){ drawHive(); return; }
    ctx.clearRect(0,0,(canvas._cssW||canvas.width),(canvas._cssH||canvas.height));
    const proj=cells.map((c,i)=>({i, ...project(c)}));
    proj.sort((a,b)=>b.depth-a.depth);        // painter's: far first
    screenPts=new Array(cells.length);
    for(const pr of proj){
      const c=cells[pr.i];
      const r=Math.max(3, 9*pr.scale*zoom);
      screenPts[pr.i]={x:pr.sx,y:pr.sy,r};
      hexPath(pr.sx,pr.sy,r);
      ctx.fillStyle=c.hex;
      ctx.globalAlpha=0.45+0.55*pr.scale;
      ctx.fill();
      ctx.globalAlpha=1;
      if(pr.i===selected){ ctx.lineWidth=2.5; ctx.strokeStyle='#fff'; }
      else { ctx.lineWidth=0.6; ctx.strokeStyle='rgba(0,0,0,0.5)'; }
      ctx.stroke();
    }
    // highlight ring on selected
    if(selected>=0 && screenPts[selected]){
      const sp=screenPts[selected];
      ctx.beginPath(); ctx.arc(sp.x,sp.y,sp.r+6,0,7); ctx.strokeStyle='#5eead4'; ctx.lineWidth=2; ctx.stroke();
    }
    // GIANT HEXAGON BORDER — appears as you zoom out; the layer shell bounding the whole lattice
    if(zoom <= 0.95){
      let maxR=0, cx=0, cy=0, n=0;
      for(const sp of screenPts){ if(sp){ cx+=sp.x; cy+=sp.y; n++; } }
      if(n){ cx/=n; cy/=n;
        for(const sp of screenPts){ if(sp){ const d=Math.hypot(sp.x-cx,sp.y-cy); if(d>maxR)maxR=d; } }
        const R=maxR+14;
        // fade in the more you zoom out
        const a=Math.min(1,(0.95-zoom)/0.5);
        ctx.save();
        ctx.beginPath();
        for(let k=0;k<6;k++){ const ang=Math.PI/180*(60*k+30)+yaw*0.5; const px=cx+R*Math.cos(ang), py=cy+R*Math.sin(ang); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }
        ctx.closePath();
        ctx.strokeStyle='rgba(212,175,55,'+(0.85*a)+')';   // gold
        ctx.lineWidth=2.5; ctx.shadowColor='#d4af37'; ctx.shadowBlur=12*a; ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha=1; ctx.fillStyle='#5eead4'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.fillText('cells:'+cells.length+'  zoom:'+zoom.toFixed(2)+(zoom<=0.95?'  ⬢ hexagon shell':'  tap a hexagon'), 6, 14);
  }

  function loop(){
    if(spinning){ yaw+=0.004; draw(); }
    else if(lotusMode && lotus4D){ lotusPhase+=0.012; draw(); }   // continuous 4D rotation
    raf=requestAnimationFrame(loop);
  }

  // Bee inside a SPHERE of cells. Camera at centre looking out; drag = look around (yaw/pitch).
  // Cells distributed on a sphere via Fibonacci lattice; neighbours linked by share-5 edges.
  let hiveHitboxes=[], hiveSphere=[];
  function buildSphereLayout(){
    const N=hiveCells.length; if(!N) return;
    // neighbour-walk order from home so adjacent sphere cells are kin (colour flows in bands)
    const used=new Uint8Array(N), order=[]; let cur=homeIdx>=0?homeIdx:0;
    used[cur]=1; order.push(cur);
    for(let s=1;s<N;s++){
      const nb=hiveCells[cur].nb.filter(j=>!used[j]);
      let nx=-1;
      if(nb.length) nx=nb[0];
      else { let bd=Infinity; const h0=hiveCells[cur].hex;
        for(let j=0;j<N;j++){ if(used[j])continue; const d=hexColDist(h0,hiveCells[j].hex); if(d<bd){bd=d;nx=j;} } }
      if(nx<0){ for(let j=0;j<N;j++) if(!used[j]){nx=j;break;} }
      if(nx<0) break; used[nx]=1; order.push(nx); cur=nx;
    }
    // Fibonacci sphere: even spread, Voronoi cells ~hexagonal (real-comb look), gapless
    const GA=Math.PI*(3-Math.sqrt(5));
    hiveSphere=new Array(N);
    order.forEach((ci,k)=>{
      const y=1-2*(k+0.5)/N, r=Math.sqrt(Math.max(0,1-y*y)), th=k*GA;
      hiveSphere[ci]=[r*Math.cos(th), y, r*Math.sin(th)];
    });
    for(let i=0;i<N;i++) if(!hiveSphere[i]) hiveSphere[i]=[0,1,0];
    // angular cell radius so hexagons touch (gapless): ~1.15 × point spacing
    hiveCellAng = 1.15 * Math.sqrt(4/ N);     // ≈ spacing on unit sphere
  }
  let hiveCellAng=0.11;
  // ── SOLID MODE: rhombic-dodecahedron (FCC) lattice — the comb gone volumetric ──
  // FCC points are the centres of space-filling rhombic dodecahedra; each touches 12
  // neighbours (matching the 12 semitones). Cell silhouette = hexagon (cube-shadow).
  let hiveSolid=[], solidMode=false, fccSpacing=1, camDist=3.4, solidFidelity=0;
  // the 12 FCC nearest-neighbour directions (rhombic-dodecahedron faces), dist^2 = 2
  const FCC_DIRS=[[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]];
  function buildSolidLayout(){
    const N=hiveCells.length; if(!N) return;
    hiveSolid=new Array(N).fill(null);
    const occ=new Map(); const K=p=>p[0]+','+p[1]+','+p[2];
    const start=homeIdx>=0?homeIdx:0;
    hiveSolid[start]=[0,0,0]; occ.set(K([0,0,0]),start);
    const queue=[start], seen=new Set([start]);
    // BFS, but place each cell in the free slot adjacent to the MOST of its already-placed
    // musical neighbours — maximises true semitone-adjacency in the lattice.
    while(queue.length){
      const cur=queue.shift();
      for(const nb of hiveCells[cur].nb){
        if(hiveSolid[nb]||seen.has(nb)) continue;
        // candidate slots = free FCC cells next to nb's already-placed neighbours (+ next to cur)
        const cands=new Map();
        const consider=p=>{ for(const d of FCC_DIRS){ const np=[p[0]+d[0],p[1]+d[1],p[2]+d[2]]; const k=K(np); if(!occ.has(k)) cands.set(k,np); } };
        consider(hiveSolid[cur]);
        for(const nn of (hiveCells[nb].nbSemi||[])){ if(hiveSolid[nn]) consider(hiveSolid[nn]); }
        let best=null,bestScore=-1;
        for(const np of cands.values()){
          let sc=0; for(const nn of (hiveCells[nb].nbSemi||[])){ const r=hiveSolid[nn]; if(!r) continue;
            if((np[0]-r[0])**2+(np[1]-r[1])**2+(np[2]-r[2])**2===2) sc++; }
          if(sc>bestScore){ bestScore=sc; best=np; }
        }
        if(best){ hiveSolid[nb]=best; occ.set(K(best),nb); seen.add(nb); queue.push(nb); }
      }
    }
    // any unplaced cell: drop into the nearest free FCC point
    let R=1, pts=[];
    while(pts.length<N*3 && R<48){ pts=[]; for(let x=-R;x<=R;x++)for(let y=-R;y<=R;y++)for(let z=-R;z<=R;z++) if(((x+y+z)&1)===0) pts.push([x,y,z]); R++; }
    pts.sort((a,b)=>(a[0]*a[0]+a[1]*a[1]+a[2]*a[2])-(b[0]*b[0]+b[1]*b[1]+b[2]*b[2]));
    let pi=0;
    for(let i=0;i<N;i++){ if(hiveSolid[i]) continue;
      while(pi<pts.length && occ.has(K(pts[pi]))) pi++;
      if(pi<pts.length){ hiveSolid[i]=pts[pi]; occ.set(K(pts[pi]),i); pi++; } else hiveSolid[i]=[0,0,0];
    }
    // spacing scale + measure how many semitone-neighbours ended up truly adjacent (dist^2==2)
    let maxr=1, adj=0, totp=0;
    for(let i=0;i<N;i++){ const p=hiveSolid[i]; if(!p) continue;
      const r=Math.hypot(p[0],p[1],p[2]); if(r>maxr)maxr=r;
      for(const nb of (hiveCells[i].nbSemi||[])){ const q=hiveSolid[nb]; if(!q) continue; totp++;
        const dd=(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2; if(dd===2) adj++; }
    }
    fccSpacing=1/maxr;
    solidFidelity = totp? Math.round(100*adj/totp) : 0;
  }
  function drawHiveSolid(){
    const W=(canvas._cssW||canvas.width),H=(canvas._cssH||canvas.height),cx=W/2,cy=H/2;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#05010a'; ctx.fillRect(0,0,W,H);
    hiveHitboxes=[];
    if(beeAt<0||!hiveCells.length){ ctx.fillStyle='#a78bfa';ctx.font='13px Bangers';ctx.textAlign='center';ctx.fillText('press ⬨ SOLID to enter',cx,cy); return; }
    if(hiveSolid.length!==hiveCells.length) buildSolidLayout();
    const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const focal=Math.min(W,H)*0.95*zoom;
    const S=fccSpacing*2.0;
    const neighbours=new Set(hiveCells[beeAt].nb);
    const orderOf=new Map(); (hiveCells[beeAt].nbSemi||[]).forEach((j,k)=>orderOf.set(j,k+1));  // ordered 1-note neighbours
    const list=[];
    for(let i=0;i<hiveCells.length;i++){
      const p=hiveSolid[i]; if(!p) continue;
      let x=p[0]*S,y=p[1]*S,z=p[2]*S;
      let x1=x*cyaw - z*syaw, z1=x*syaw + z*cyaw;     // yaw about Y
      let y2=y*cp - z1*sp,    z2=y*sp + z1*cp;          // pitch about X
      const depth=camDist - z2;                         // orbit camera at +camDist
      if(depth<=0.25) continue;
      const sx=cx + (x1/depth)*focal, sy=cy - (y2/depth)*focal;
      const rad=Math.max(3, S*focal/depth*0.6);
      if(sx<-rad||sx>W+rad||sy<-rad||sy>H+rad) continue;
      list.push({i,sx,sy,rad,depth});
    }
    list.sort((a,b)=>b.depth-a.depth);                  // far first (painter)
    for(const o of list){
      const c=hiveCells[o.i], isBee=o.i===beeAt, isNb=neighbours.has(o.i), isHome=o.i===homeIdx;
      const fade=Math.max(0.22,Math.min(1,(camDist+1.6-o.depth)/2.2));
      const outline = isBee?'#fff' : isHome?'#c4b5fd' : isNb?'#fde68a' : 'rgba(160,130,60,'+(0.55*fade)+')';
      const lw = isBee?2.6 : (isHome||isNb)?1.8 : 0.8;
      drawCubeCell(o.sx,o.sy,o.rad,c.hex,fade,outline,lw);
      if(isBee||isHome){ ctx.shadowColor=isBee?'#fff':'#a78bfa'; ctx.shadowBlur=12;
        ctx.strokeStyle=outline; ctx.lineWidth=lw; 
        ctx.beginPath(); const a0=-Math.PI/2; for(let k=0;k<6;k++){const a=a0+k*Math.PI/3,px=o.sx+o.rad*Math.cos(a),py=o.sy+o.rad*Math.sin(a);k?ctx.lineTo(px,py):ctx.moveTo(px,py);} ctx.closePath(); ctx.stroke(); ctx.shadowBlur=0; }
      // label only the cells that matter (bee/home/neighbours) so the lattice stays readable
      if((isBee||isHome||isNb) && o.rad>=12){
        ctx.fillStyle='#fff'; ctx.font=Math.round(o.rad*0.42)+'px Bangers';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.shadowColor='#000'; ctx.shadowBlur=3; ctx.fillText(cellLabel(c),o.sx,o.sy); ctx.shadowBlur=0; ctx.textBaseline='alphabetic';
      }
      hiveHitboxes.push({x:o.sx,y:o.sy,r:o.rad,idx:o.i});
      // ordered 1-note neighbours: small index badge showing voice-leading order
      if(orderOf.has(o.i) && o.rad>=9){
        const ord=orderOf.get(o.i);
        ctx.fillStyle='#fde68a'; ctx.font=Math.round(o.rad*0.5)+'px Bangers';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.shadowColor='#000'; ctx.shadowBlur=3; ctx.fillText(String(ord), o.sx, o.sy - o.rad*0.55); ctx.shadowBlur=0; ctx.textBaseline='alphabetic';
      }
    }
    ctx.fillStyle='#a78bfa'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.fillText('⬨ rhombic lattice · touching = 1-semitone move · '+solidFidelity+'% adjacency · drag orbit · tap to fly', 6, 14);
  }
  // ═══ INSIDE POV — stand at the centre of a honeycomb egg of ALL known scales ═══
  let povMode=false, hivePov=[], povScales=[], povSel=-1, povFidelity=0, povReach=[], povSpatial=[];

  // ── INSIDE POV: icosphere geodesic sphere (2 subdivisions=162 verts, 480 edges).
  //    Face-BFS seeds every new vertex from the intersection of its 2 triangle-partners'
  //    one-note-different sets — guaranteed by construction on triangle edges.
  //    Repair passes fix cross-face seams to push fidelity toward 100%. ──
  function buildPovLayout(){
    if(!hiveCells.length) buildHive();
    const S=hiveCells.length; if(!S){ hivePov=[]; povScales=[]; return; }
    const sz=hiveCells[0]?hiveCells[0].semis.length:6;
    const nbAny=hiveCells.map((c,i)=>{const a=[];for(let j=0;j<S;j++){if(i===j)continue;if(pop12(c.id&hiveCells[j].id)===sz-1)a.push(j);}return a;});
    const nbAnySet=nbAny.map(a=>new Set(a));
    const EGG_Y=1.34, tau2=(1+Math.sqrt(5))/2;
    const vB=[[-1,tau2,0],[1,tau2,0],[-1,-tau2,0],[1,-tau2,0],[0,-1,tau2],[0,1,tau2],[0,-1,-tau2],[0,1,-tau2],[tau2,0,-1],[tau2,0,1],[-tau2,0,-1],[-tau2,0,1]].map(v=>{const l=Math.hypot(...v);return v.map(x=>x/l);});
    const fB=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
    const verts=[...vB.map(v=>[...v])]; const emid=new Map();
    const gm=(a,b)=>{const k=Math.min(a,b)+'_'+Math.max(a,b);if(emid.has(k))return emid.get(k);
      const v1=verts[a],v2=verts[b],m=v1.map((x,ii)=>(x+v2[ii])/2),l=Math.hypot(...m),id=verts.length;
      verts.push(m.map(x=>x/l));emid.set(k,id);return id;};
    let faces=[...fB];
    for(let s=0;s<2;s++){const nf=[];for(const[a,b,c]of faces){const m1=gm(a,b),m2=gm(b,c),m3=gm(a,c);nf.push([a,m1,m3],[b,m2,m1],[c,m3,m2],[m1,m2,m3]);}faces=nf;}
    const P=verts.length;
    const pos=verts.map(([x,y,z])=>[x,y*EGG_Y,z]);
    const adjSet=Array.from({length:P},()=>new Set());
    faces.forEach(([a,b,c])=>{adjSet[a].add(b);adjSet[a].add(c);adjSet[b].add(a);adjSet[b].add(c);adjSet[c].add(a);adjSet[c].add(b);});
    const spat=adjSet.map(s=>[...s]);
    const edges=[]; const ec2=new Set();
    for(let i=0;i<P;i++)for(const j of spat[i]){const k=i<j?i*P+j:j*P+i;if(!ec2.has(k)){ec2.add(k);edges.push([i,j]);}}
    const ef=new Map();
    faces.forEach((f,fi)=>{for(let k=0;k<3;k++){const a=f[k],b=f[(k+1)%3],e=Math.min(a,b)+'_'+Math.max(a,b);if(!ef.has(e))ef.set(e,[]);ef.get(e).push(fi);}});
    const fadj=faces.map((_,fi)=>{const a=new Set();for(let k=0;k<3;k++){const a2=faces[fi][k],b2=faces[fi][(k+1)%3],e=Math.min(a2,b2)+'_'+Math.max(a2,b2);(ef.get(e)||[]).forEach(fi2=>{if(fi2!==fi)a.add(fi2);});}return[...a];});
    const assign=new Array(P).fill(-1); const usedSc=new Set();
    const setA=(p,c)=>{assign[p]=c;usedSc.add(c);};
    const sd=homeIdx>=0?homeIdx:0;
    const s1p=nbAny[sd]&&nbAny[sd].length?nbAny[sd][0]:(nbAny.findIndex(a=>a.length>0));
    if(s1p<0||s1p===undefined){ hivePov=pos; povScales=pos.map(()=>{const c=hiveCells[sd]||hiveCells[0];return{sig:c.sig,hex:c.hex,semis:c.semis,root:c.root,cell:sd};}); return; }
    const c0=[...nbAnySet[sd]].filter(c=>nbAnySet[s1p].has(c)&&c!==sd&&c!==s1p);
    const s2seed=c0.length?c0[0]:(nbAny[s1p]&&nbAny[s1p].length?nbAny[s1p][0]:sd);
    setA(faces[0][0],sd); setA(faces[0][1],s1p); setA(faces[0][2],s2seed);
    const fq=[0],fseen=new Uint8Array(faces.length); fseen[0]=1;
    while(fq.length){const fi=fq.shift();const[a,b,c]=faces[fi];
      for(const[u,v,w]of[[a,b,c],[b,c,a],[c,a,b]]){if(assign[u]>=0)continue;
        const sv=assign[v],sw=assign[w];if(sv<0||sw<0)continue;
        let inter=[...nbAnySet[sv]].filter(c2=>nbAnySet[sw].has(c2));
        inter.sort((x,y)=>(usedSc.has(x)?1:0)-(usedSc.has(y)?1:0));
        setA(u,inter.length?inter[0]:nbAny[sv][0]);}
      fadj[fi].forEach(fi2=>{if(!fseen[fi2]){fseen[fi2]=1;fq.push(fi2);}});}
    for(let p=0;p<P;p++){if(assign[p]>=0)continue;
      const nb2=spat[p].filter(s=>assign[s]>=0).map(s=>assign[s]);if(!nb2.length){setA(p,sd);continue;}
      let c2=[...nbAnySet[nb2[0]]];for(let k=1;k<nb2.length&&c2.length;k++)c2=c2.filter(c=>nbAnySet[nb2[k]].has(c));
      setA(p,c2.length?c2[0]:nb2[0]);}
    const t0=Date.now();
    for(let rep=0;rep<500&&Date.now()-t0<1400;rep++){let imp=0;
      for(const[i,j]of edges){if(nbAnySet[assign[i]].has(assign[j]))continue;
        for(const[u,v]of[[i,j],[j,i]]){
          const allNbs=spat[u].map(s=>assign[s]);
          const pool=new Set([assign[v]]);for(const d of allNbs)for(const c of nbAnySet[d])pool.add(c);
          let best=assign[u],bs=allNbs.filter(d=>nbAnySet[assign[u]].has(d)).length;
          for(const c of pool){if(c===assign[u])continue;const sc=allNbs.filter(d=>nbAnySet[c].has(d)).length;if(sc>bs){bs=sc;best=c;}}
          if(best!==assign[u]){assign[u]=best;imp++;break;}}
        if(!nbAnySet[assign[i]].has(assign[j])){
          const ai=assign[i],aj=assign[j];
          const bef=spat[i].map(s=>assign[s]).filter(d=>!nbAnySet[ai].has(d)).length+spat[j].map(s=>assign[s]).filter(d=>!nbAnySet[aj].has(d)).length;
          assign[i]=aj;assign[j]=ai;
          const aft=spat[i].map(s=>assign[s]).filter(d=>!nbAnySet[aj].has(d)).length+spat[j].map(s=>assign[s]).filter(d=>!nbAnySet[ai].has(d)).length;
          if(aft>=bef){assign[i]=ai;assign[j]=aj;}else imp++;}}
      if(!imp)break;}
    // Simulated annealing: escape the local optimum the greedy repair can't crack
    {const badAt=p=>spat[p].map(s=>assign[s]).filter(d=>!nbAnySet[assign[p]].has(d)).length;
     let T=1.5; const saT=Date.now();
     for(let it=0;it<P*1000&&Date.now()-saT<1200;it++){T*=0.9999;
       const p=(Math.random()*P)|0;
       const allNbs=spat[p].map(s=>assign[s]);const pool=new Set();for(const d of allNbs)for(const c of nbAnySet[d])pool.add(c);
       const cands=[...pool];if(!cands.length)continue;
       const nc=cands[(Math.random()*cands.length)|0];
       const cur=allNbs.filter(d=>!nbAnySet[assign[p]].has(d)).length;
       const nxt=allNbs.filter(d=>!nbAnySet[nc].has(d)).length;
       if(nxt<cur||Math.random()<Math.exp((cur-nxt)/T))assign[p]=nc;}
     // final greedy cleanup after SA
     for(let rep=0;rep<50;rep++){let imp=0;
       for(const[i,j]of edges){if(nbAnySet[assign[i]].has(assign[j]))continue;
         for(const[u,v]of[[i,j],[j,i]]){const allNbs=spat[u].map(s=>assign[s]);const pool=new Set([assign[v]]);for(const d of allNbs)for(const c of nbAnySet[d])pool.add(c);
           let best=assign[u],bs=allNbs.filter(d=>nbAnySet[assign[u]].has(d)).length;for(const c of pool){if(c===assign[u])continue;const sc=allNbs.filter(d=>nbAnySet[c].has(d)).length;if(sc>bs){bs=sc;best=c;}}
           if(best!==assign[u]){assign[u]=best;imp++;break;}}}
       if(!imp)break;}}
    let good=0; for(const[i,j]of edges)if(nbAnySet[assign[i]].has(assign[j]))good++;
    povFidelity=edges.length?Math.round(good/edges.length*100):0;
    const d2p=(a,b)=>{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;};
    povReach=new Array(P);
    for(let i=0;i<P;i++){let mx=0;for(const j of spat[i]){const d=Math.sqrt(d2p(pos[i],pos[j]));if(d>mx)mx=d;}povReach[i]=mx||0.2;}
    hivePov=pos; povSpatial=spat;
    povScales=assign.map(cidx=>{const c=hiveCells[cidx]||hiveCells[0];return{sig:c.sig,hex:c.hex,semis:c.semis,root:c.root,cell:cidx};});
    const bad=edges.length-good;
    console.log('[POV] icosphere V='+P+' E='+edges.length+' · '+povFidelity+'% 1-note-diff · '+bad+' seam edges');
  }

  function drawFlatHex(sx,sy,rad,hex,fade,outline,lw){
    ctx.save();
    ctx.beginPath(); const a0=-Math.PI/2;
    for(let k=0;k<6;k++){ const a=a0+k*Math.PI/3, px=sx+rad*Math.cos(a), py=sy+rad*Math.sin(a); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }
    ctx.closePath();
    ctx.globalAlpha=fade; ctx.fillStyle=hex; ctx.fill();
    if(outline){ ctx.globalAlpha=Math.min(1,fade+0.3); ctx.strokeStyle=outline; ctx.lineWidth=lw; ctx.stroke(); }
    ctx.restore();
  }
  // a curved, domed hex tile: radial gradient (lit centre → shaded rim) reads as a sphere facet
  function drawDomeHex(sx,sy,rad,hex,fade){
    ctx.save();
    ctx.beginPath(); const a0=-Math.PI/2;
    for(let k=0;k<6;k++){ const a=a0+k*Math.PI/3, px=sx+rad*Math.cos(a), py=sy+rad*Math.sin(a); k?ctx.lineTo(px,py):ctx.moveTo(px,py); }
    ctx.closePath(); ctx.clip();
    const g=ctx.createRadialGradient(sx-rad*0.28, sy-rad*0.28, rad*0.1, sx, sy, rad*1.15);
    g.addColorStop(0, shade(hex,1.18)); g.addColorStop(0.6, hex); g.addColorStop(1, shade(hex,0.72));
    ctx.globalAlpha=fade; ctx.fillStyle=g;
    ctx.fillRect(sx-rad,sy-rad,rad*2,rad*2);
    ctx.restore();
  }
  function shade(hex,f){ const h=hex.replace('#',''); let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    r=Math.max(0,Math.min(255,Math.round(r*f))); g=Math.max(0,Math.min(255,Math.round(g*f))); b=Math.max(0,Math.min(255,Math.round(b*f)));
    return 'rgb('+r+','+g+','+b+')'; }

  function drawHivePov(){
    const W=(canvas._cssW||canvas.width),H=(canvas._cssH||canvas.height),cx=W/2,cy=H/2;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#07060c'; ctx.fillRect(0,0,W,H);
    hiveHitboxes=[];
    if(!povScales.length || hivePov.length!==povScales.length) buildPovLayout();
    if(!povScales.length){ ctx.fillStyle='#67e8f9';ctx.font='13px Bangers';ctx.textAlign='center';ctx.fillText('building scale-egg…',cx,cy); return; }
    const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const focal=Math.min(W,H)*0.62*zoom;
    const radMax=Math.min(W,H)*0.5;
    const list=[];
    for(let i=0;i<hivePov.length;i++){
      const p=hivePov[i]; if(!p) continue;
      const x=p[0],y=p[1],z=p[2];
      const x1=x*cyaw - z*syaw, z1=x*syaw + z*cyaw;   // yaw
      const y2=y*cp - z1*sp,    z2=y*sp + z1*cp;        // pitch
      const depth=z2;
      if(depth<=0.06) continue;                         // forward dome
      const sx=cx + (x1/depth)*focal, sy=cy - (y2/depth)*focal;
      // size to REACH the farthest neighbour (×overlap) so tiles meet — no black gaps
      let rad=Math.min(radMax, (povReach[i]*0.62)*focal/depth);
      if(rad<1) continue;
      if(sx<-rad||sx>W+rad||sy<-rad||sy>H+rad) continue;
      list.push({i,sx,sy,rad,depth});
    }
    list.sort((a,b)=>b.depth-a.depth);                  // far first → near overwrites (gapless)
    for(const o of list){
      const sc=povScales[o.i], isSel=o.i===povSel;
      const fade=Math.max(0.5,Math.min(1,1.2-o.depth*0.45));
      drawDomeHex(o.sx,o.sy,o.rad,sc.hex,fade);
      if(isSel){ ctx.save(); ctx.strokeStyle='#fff'; ctx.lineWidth=2.6; ctx.shadowColor='#fff'; ctx.shadowBlur=10;
        ctx.beginPath(); const a0=-Math.PI/2; for(let k=0;k<6;k++){const a=a0+k*Math.PI/3,px=o.sx+o.rad*Math.cos(a),py=o.sy+o.rad*Math.sin(a);k?ctx.lineTo(px,py):ctx.moveTo(px,py);} ctx.closePath(); ctx.stroke(); ctx.restore();
        if(o.rad>=11){ ctx.fillStyle='#fff'; ctx.font=Math.round(o.rad*0.38)+'px Bangers';
          ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowColor='#000'; ctx.shadowBlur=3;
          ctx.fillText((sc.sig.keyName||G.NOTES[sc.root])+' '+(sc.sig.name||''),o.sx,o.sy); ctx.shadowBlur=0; ctx.textBaseline='alphabetic'; } }
      hiveHitboxes.push({x:o.sx,y:o.sy,r:o.rad*0.7,idx:o.i,pov:true});
    }
    ctx.fillStyle='#67e8f9'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.shadowColor='#000'; ctx.shadowBlur=3;
    ctx.fillText('👁 inside · '+povScales.length+' cells · '+povFidelity+'% 1-note neighbours · drag to look · tap a cell', 6, 14);
    ctx.shadowBlur=0;
  }

  function drawHive(){
    if(povMode){ drawHivePov(); return; }
    if(solidMode){ drawHiveSolid(); return; }
    const W=(canvas._cssW||canvas.width),H=(canvas._cssH||canvas.height),cx=W/2,cy=H/2;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#0a0500'; ctx.fillRect(0,0,W,H);     // dark hive interior
    hiveHitboxes=[];
    if(beeAt<0||!hiveCells.length){ ctx.fillStyle='#fbbf24';ctx.font='13px Bangers';ctx.textAlign='center';ctx.fillText('press 🍯 HIVE to enter',cx,cy); return; }
    if(hiveSphere.length!==hiveCells.length) buildSphereLayout();
    // camera at centre looking OUT; yaw/pitch turn the head
    const cy_=Math.cos(yaw), sy_=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
    const focal=Math.min(W,H)*0.62*zoom;     // FOV; pinch zoom changes it
    const neighbours=new Set(hiveCells[beeAt].nb);
    const list=[];
    for(let i=0;i<hiveCells.length;i++){
      let [x,y,z]=hiveSphere[i];
      // yaw about Y, then pitch about X
      let x1=x*cy_ - z*sy_, z1=x*sy_ + z*cy_;
      let y2=y*cp - z1*sp, z2=y*sp + z1*cp;
      if(z2<=0.12) continue;                  // behind / too far to the side
      const sx=cx + (x1/z2)*focal, sy2=cy + (y2/z2)*focal;
      // angular size → screen radius; head-on (z2≈1) biggest, edges shrink
      let rad=(hiveCellAng)*focal/z2;
      rad=Math.min(rad, Math.min(W,H)*0.22);  // clamp huge edge cells
      if(sx<-rad||sx>W+rad||sy2<-rad||sy2>H+rad) continue;
      list.push({i,sx,sy:sy2,rad,z2});
    }
    list.sort((a,b)=>a.z2-b.z2);              // far first, near on top
    for(const o of list){
      const c=hiveCells[o.i], isBee=o.i===beeAt, isNb=neighbours.has(o.i), isHome=o.i===homeIdx;
      hexPath(o.sx,o.sy,o.rad);
      ctx.fillStyle=c.hex; ctx.globalAlpha=Math.max(0.45,Math.min(1,o.z2)); ctx.fill(); ctx.globalAlpha=1;
      if(isBee){ ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=12; ctx.stroke(); ctx.shadowBlur=0; }
      else if(isHome){ ctx.lineWidth=2.5; ctx.strokeStyle='#bfffbf'; ctx.shadowColor='#7fff7f'; ctx.shadowBlur=14; ctx.stroke(); ctx.shadowBlur=0; }
      else if(isNb){ ctx.lineWidth=1.8; ctx.strokeStyle='#fde68a'; ctx.stroke(); }
      else { ctx.lineWidth=1; ctx.strokeStyle='rgba(124,94,30,0.85)'; ctx.stroke(); }
      if(o.rad>=15){
        const nm=cellLabel(c);
        ctx.fillStyle=pickTextColour(c.hex); ctx.font=Math.round(o.rad*0.4)+'px Bangers';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(nm,o.sx,o.sy); ctx.textBaseline='alphabetic';
      }
      hiveHitboxes.push({x:o.sx,y:o.sy,r:o.rad,idx:o.i});
    }
    ctx.fillStyle='#fbbf24'; ctx.font='11px Bangers'; ctx.textAlign='left';
    ctx.fillText('🍯 inside the comb · drag to look around · tap a cell'+(foraging?' · foraging…':''), 6, 14);
  }
  function pickTextColour(hex){
    const v=parseInt(hex.slice(1),16); const r=(v>>16)&255,g=(v>>8)&255,b=v&255;
    return (0.299*r+0.587*g+0.114*b)>140 ? '#000' : '#fff';
  }
  // unique label per cell: these are 462 hexatonic SHAPES on one root, so key letter is identical
  // and useless — use the Ring 12-bit ID (hex) which is unique per shape; known scales show their name
  function cellLabel(c){
    const key=c.sig.keyName||G.NOTES[c.sig.root||0];
    if(c.sig.name) return (key+' '+c.sig.name).slice(0,7);
    return key;                                   // varied key letter (canonical root)
  }
  // shade a hex colour by a brightness factor (for the 3 cube faces)
  function shadeHex(hex,f){
    const v=parseInt(hex.slice(1),16); let r=(v>>16)&255,g=(v>>8)&255,b=v&255;
    r=Math.max(0,Math.min(255,Math.round(r*f))); g=Math.max(0,Math.min(255,Math.round(g*f))); b=Math.max(0,Math.min(255,Math.round(b*f)));
    return 'rgb('+r+','+g+','+b+')';
  }
  // draw a cell AS A CUBE/rhombic-dodecahedron silhouette: hexagon split into 3 rhombi
  // (the cube-seen-down-its-diagonal). 3 brightness levels = the 3 visible faces → reads 3D.
  function drawCubeCell(x,y,r,hex,alpha,outline,lw){
    const a0=-Math.PI/2;                       // pointy-top so the internal Y points up
    const V=[]; for(let k=0;k<6;k++){ const a=a0+k*Math.PI/3; V.push([x+r*Math.cos(a),y+r*Math.sin(a)]); }
    const faces=[[0,1,2],[2,3,4],[4,5,0]];     // 3 rhombi (centre + 3 consecutive verts)
    const fac=[1.0,0.66,0.42];                 // top lit, left mid, right dark = cube shading
    ctx.globalAlpha=alpha;
    faces.forEach((f,i)=>{
      ctx.beginPath(); ctx.moveTo(x,y);
      ctx.lineTo(V[f[0]][0],V[f[0]][1]); ctx.lineTo(V[f[1]][0],V[f[1]][1]); ctx.lineTo(V[f[2]][0],V[f[2]][1]);
      ctx.closePath(); ctx.fillStyle=shadeHex(hex,fac[i]); ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=Math.max(0.5,lw*0.5); ctx.stroke();   // inner edges
    });
    ctx.globalAlpha=1;
    // outer hexagon outline (the cell's silhouette)
    ctx.beginPath();
    for(let k=0;k<6;k++){ k?ctx.lineTo(V[k][0],V[k][1]):ctx.moveTo(V[0][0],V[0][1]); }
    ctx.closePath(); ctx.strokeStyle=outline; ctx.lineWidth=lw; ctx.stroke();
  }
  function faceCell(i){
    if(solidMode){ const p=hiveSolid[i]; if(!p) return;   // orbit so the cell faces front
      yaw=Math.atan2(p[0],p[2]); pitch=-Math.atan2(p[1],Math.hypot(p[0],p[2])); return; }
    const v=hiveSphere[i]; if(!v) return;   // turn head toward a cell
    yaw=Math.atan2(v[0],v[2]); pitch=-Math.atan2(v[1],Math.hypot(v[0],v[2])); }
  function pickHive(mx,my){
    let best=Infinity,hit=-1;
    for(const h of hiveHitboxes){ const d=Math.hypot(mx-h.x,my-h.y); if(d<h.r && d<best){best=d;hit=h.idx;} }
    return hit;
  }
  let selected=-1;
  function pickAt(mx,my){
    let best=Infinity, hit=-1;
    for(let i=0;i<screenPts.length;i++){ const sp=screenPts[i]; if(!sp) continue;
      const d=Math.hypot(mx-sp.x,my-sp.y); if(d<best){ best=d; hit=i; } }
    return (best<46)?hit:-1;     // generous: nearest cell within 46px
  }

  function loadCell(i){
    const c=cells[i]; if(!c) return;
    const sig=c.sig;
    spinning=false; updateSpinBtn();
    try{
      const inst=G.INST[G.getActivePrefix()];
      const keyName = sig.keyName || G.NOTES[sig.root];
      if(inst && sig.mode && G.MODE_SEMITONES[sig.mode]){
        inst.setScale(keyName, sig.mode, (sig.alt&&sig.alt!=='NA')?sig.alt:'NA');
      } else if(inst){
        // inject exact note-set as a COLOUR-mode scale
        G.MODE_SEMITONES['COLOUR'] = sig.semis.slice();
        if(typeof G.MODE_INT_NAMES!=='undefined') G.MODE_INT_NAMES['COLOUR'] = sig.semis.map(x=>G.CI_INT[((x%12)+12)%12]);
        inst.setScale(keyName, 'COLOUR', 'NA');
      }
    }catch(e){}
    document.getElementById('hiveInfo').textContent = (sig.name? ((sig.keyName||G.NOTES[sig.root])+' '+sig.name) : c.hex) + '  · Ring '+ringIdStr(ringId(sig.semis.map(x=>(((x)%12)+12)%12)));
  }

  function updateSpinBtn(){ const b=document.getElementById('hiveSpin'); if(b) b.textContent = spinning?'⏸ SPIN':'▶ SPIN'; }

  let inited=false;
  function init(){
    canvas=document.getElementById('hiveCanvas');
    if(!canvas) return;
    ctx=canvas.getContext('2d');
    try{ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';}catch(e){}
    // size backing store to displayed size × device pixel ratio so it's sharp on 4K/high-DPI.
    //   We draw in CSS-pixel coordinates (ctx scaled by DPR), so the rest of the code is unchanged.
    // v751: measure the visible panel (not a 0-width display:none ghost). Floor height so the
    //   canvas never collapses to a strip on first open in Android WebViews.
    const pan=document.getElementById('hivePanel');
    const DPR=Math.min(3,Math.max(2,window.devicePixelRatio||1));
    // v768: canvas fills space ABOVE the control strip so SPIN/ZOOM/etc stay on screen
    const vw = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 360);
    const vh = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 640);
    let chrome = 0;
    try{
      if(pan){
        const kids = [].slice.call(pan.children);
        kids.forEach(function(ch){
          if(ch === canvas) return;
          chrome += ch.offsetHeight || ch.getBoundingClientRect().height || 0;
        });
      }
    }catch(e){}
    if(chrome < 120) chrome = 200;   // title + 2 button rows + sliders fallback
    // panel padding ~20
    let cssW = Math.max(280, (pan && pan.clientWidth) ? (pan.clientWidth - 4) : (vw - 20));
    let cssH = Math.max(220, Math.min(vh - chrome - 24, Math.round(vh * 0.55)));
    canvas.style.cssText = 'display:block;width:100%;flex:1 1 auto;height:'+cssH+'px;min-height:'+cssH+'px;max-height:'+cssH+'px;background:radial-gradient(circle at 50% 40%, #06201c, #010a09);border:1px solid #134e4a;border-radius:6px;touch-action:none;cursor:grab;';
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    canvas._cssW = cssW;
    canvas._cssH = cssH;
    const ok=buildCells(parseInt(document.getElementById('hiveCount').value,10)||260);
    if(!ok){
      ctx.fillStyle='#5eead4'; ctx.font='14px Bangers'; ctx.textAlign='center';
      ctx.fillText('building scale universe…', (canvas._cssW||canvas.width)/2, (canvas._cssH||canvas.height)/2);
      setTimeout(init, 250);
      return;
    }
    if(!inited){
      inited=true;
      const ptrs=new Map();
      let pinchStartDist=0, pinchStartZoom=1;
      canvas.addEventListener('pointerdown',e=>{
        ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
        try{canvas.setPointerCapture(e.pointerId);}catch(x){}
        if(ptrs.size===2){
          // begin pinch
          const p=[...ptrs.values()];
          pinchStartDist=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1;
          pinchStartZoom=zoom; dragging=false;
        } else {
          dragging=true; moved=0; lastX=e.clientX; lastY=e.clientY; canvas.style.cursor='grabbing'; spinning=false; updateSpinBtn();
        }
      });
      canvas.addEventListener('pointermove',e=>{
        if(ptrs.has(e.pointerId)) ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(ptrs.size>=2){
          const p=[...ptrs.values()];
          const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1;
          zoom=Math.max(0.3,Math.min(5, pinchStartZoom*(d/pinchStartDist)));
          draw();
          return;
        }
        if(!dragging) return;
        const dx=e.clientX-lastX, dy=e.clientY-lastY; moved+=Math.abs(dx)+Math.abs(dy);
        if(povMode){ yaw+=dx*0.006; pitch-=dy*0.006; }      // first-person look (not inverted)
        else { yaw-=dx*0.006; pitch-=dy*0.006; }            // orbit the object
        pitch=Math.max(-1.5,Math.min(1.5,pitch));
        lastX=e.clientX; lastY=e.clientY; draw();
      });
      function endPtr(e){
        ptrs.delete(e.pointerId);
        if(ptrs.size<2) pinchStartDist=0;
        if(ptrs.size===0){
          dragging=false; canvas.style.cursor='grab';
          if(moved<8 && e.type==='pointerup'){
            const rect=canvas.getBoundingClientRect();
            const mx=(e.clientX-rect.left)*(canvas._cssW||canvas.width)/rect.width, my=(e.clientY-rect.top)*(canvas._cssH||canvas.height)/rect.height;
            const hit=pickAt(mx,my);
          if(povMode){ const hh=pickHive(mx,my); if(hh>=0){ povSel=hh; loadPovScale(hh); draw(); } }
          else if(hiveMode){ const hh=pickHive(mx,my); if(hh>=0){ beeAt=hh; faceCell(hh); loadHiveCell(hh); draw(); } }
          else if(hit>=0){ selected=hit; loadCell(hit); draw(); }
          }
        }
      }
      canvas.addEventListener('pointerup',endPtr);
      canvas.addEventListener('pointercancel',endPtr);
      document.getElementById('hiveSpin').addEventListener('click',()=>{ spinning=!spinning; updateSpinBtn(); if(spinning&&!raf) loop(); });
      document.getElementById('hiveCount').addEventListener('input',e=>{ buildCells(parseInt(e.target.value,10)); if(lotusMode) layoutRosette(lotus4D?'note':'colour'); selected=-1; draw(); });
      const zi=document.getElementById('hiveZoomIn'), zo=document.getElementById('hiveZoomOut');
      if(zi) zi.addEventListener('click',()=>{ zoom=Math.min(5,zoom*1.4); draw(); });
      if(zo) zo.addEventListener('click',()=>{ zoom=Math.max(0.3,zoom/1.4); draw(); });
      const mcS=document.getElementById('hiveMyCol'), rbS=document.getElementById('hiveRing');
      if(mcS) mcS.addEventListener('input',e=>{ myColourPct=+e.target.value; document.getElementById('hiveMyColV').textContent=myColourPct; recolour(); draw(); });
      if(rbS) rbS.addEventListener('input',e=>{ ringBrightPct=+e.target.value; document.getElementById('hiveRingV').textContent=ringBrightPct; recolour(); draw(); });
      const latB=document.getElementById('hiveLattice');
      if(latB) latB.addEventListener('click',()=>{ lotusMode=false; latticeMode=!latticeMode; latB.textContent=latticeMode?'⬢ LATTICE':'☁ CLOUD'; if(latticeMode) layoutLattice(); selected=-1; hiveMode=false; solidMode=false; draw(); });
      const lotB=document.getElementById('hiveLotus');
      if(lotB) lotB.addEventListener('click',()=>{
        lotusMode=!lotusMode; lotus4D=false;                 // LOTUS = flat; the ✦ 4D button does 4D
        const l4=document.getElementById('hiveLotus4d'); if(l4) l4.textContent='✦ 4D';
        if(lotusMode){ hiveMode=false; solidMode=false; povMode=false; spinning=false; updateSpinBtn(); zoom=1; layoutRosette('colour'); }
        lotB.textContent = lotusMode?'✿ LOTUS ✓':'✿ LOTUS';
        selected=-1; draw();
      });
      const lot4=document.getElementById('hiveLotus4d');
      if(lot4) lot4.addEventListener('click',()=>{
        lotus4D=!lotus4D;
        if(lotus4D){ lotusMode=true; hiveMode=false; solidMode=false; povMode=false; spinning=false; updateSpinBtn(); zoom=1; yaw=0; pitch=0; layoutRosette('note'); if(lotB) lotB.textContent='✿ LOTUS ✓'; if(!raf) loop(); }
        lot4.textContent = lotus4D?'✦ 4D ✓':'✦ 4D';
        selected=-1; draw();
      });
      const hvB=document.getElementById('hiveHiveMode'), fgB=document.getElementById('hiveForage');
      if(hvB) hvB.addEventListener('click',()=>{ lotusMode=false; solidMode=false; hiveMode=!hiveMode; if(hiveMode){ spinning=false; updateSpinBtn(); buildHive(); buildSphereLayout(); faceCell(homeIdx>=0?homeIdx:0); loadHiveCell(beeAt); } draw(); });
      const solidB=document.getElementById('hiveSolid');
      if(solidB) solidB.addEventListener('click',()=>{
        lotusMode=false;
        povMode=false;
        solidMode=!solidMode;
        if(solidMode){ hiveMode=true; spinning=false; updateSpinBtn(); buildHive(); buildSolidLayout(); zoom=1; yaw=0.6; pitch=0.4; faceCell(homeIdx>=0?homeIdx:0); loadHiveCell(beeAt); }
        else { hiveMode=false; }
        draw();
      });
      const povB=document.getElementById('hivePovBtn');
      if(povB) povB.addEventListener('click',()=>{
        lotusMode=false;
        povMode=!povMode;
        if(povMode){ hiveMode=true; solidMode=false; spinning=false; updateSpinBtn(); buildPovLayout(); zoom=1; yaw=0; pitch=0; povSel=-1; }
        else { hiveMode=false; }
        draw();
      });
      if(fgB) fgB.addEventListener('click',()=>{ if(!hiveMode){ hiveMode=true; spinning=false; updateSpinBtn(); buildHive(); if(solidMode) buildSolidLayout(); else buildSphereLayout(); } startForage(); });
    }
    draw();
    if(!raf) loop();
  }
  return { init, redraw:()=>draw() };
})();

// Wire panel (module may load after DOMContentLoaded)
(function wireHiveUI(){
  const btn=document.getElementById('hiveToggle'), pan=document.getElementById('hivePanel');
  if(!btn||!pan) return;
  if(btn.__hiveWired) return;
  btn.__hiveWired=true;
  btn.addEventListener('click',function(){
    const open = pan.getAttribute('data-open')==='1';
    if(!open){
      try{ if(pan.parentElement!==document.body) document.body.appendChild(pan); }catch(e){}
      pan.setAttribute('data-open','1');
      pan.classList.add('open');
      pan.style.cssText='display:flex!important;flex-direction:column!important;position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:100vw!important;max-height:100vh!important;z-index:10050!important;background:#03110f!important;padding:8px 10px 10px!important;overflow:hidden!important;box-sizing:border-box!important;margin:0!important;border:none!important;';
      void pan.offsetWidth;
      function doInit(){ try{ ScaleHive.init(); }catch(e){ console.warn('[hive]',e); } }
      requestAnimationFrame(function(){
        doInit();
        requestAnimationFrame(function(){
          doInit();
          setTimeout(doInit, 50);
          setTimeout(doInit, 200);
        });
      });
    } else {
      pan.setAttribute('data-open','0');
      pan.classList.remove('open');
      pan.style.display='none';
    }
  });
  const hc=document.getElementById('hiveClose');
  if(hc&&pan) hc.addEventListener('click',function(){
    pan.setAttribute('data-open','0');
    pan.classList.remove('open');
    pan.style.display='none';
  });
})();

window.ScaleHive = ScaleHive;
window.registerModule('hive', {
  version: MODULE_VERSION,
  isStub: false,
  ScaleHive: typeof ScaleHive !== 'undefined' ? ScaleHive : null
});
// lotus is a mode inside ScaleHive — register lotus at same version when hive loads
window.registerModule('lotus', {
  version: MODULE_VERSION,
  isStub: false,
  via: 'hive'
});
console.log('[modules] hive+lotus v' + MODULE_VERSION);
})();
