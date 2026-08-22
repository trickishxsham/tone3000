// modules/scoring/scoring.js
// version: 4.9.8.860
// Improv scoring, judges, AURA, tokens, gems, track packs economy.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';

// §SCORING ─── IMPROV SCORING + AURA SYSTEM ──────────────────────
const Scoring = (function(){
  function gradeFrom(metrics){
    const m = Object.assign({timing:0,noteChoice:0,chordTones:0,bending:0,space:0,intensity:0,comping:0}, metrics||{});
    const W = { noteChoice:0.22, timing:0.18, chordTones:0.18, space:0.14, intensity:0.12, bending:0.10, comping:0.06 };
    let score=0,wsum=0; for(const k in W){ score+=(m[k]||0)*W[k]; wsum+=W[k]; }
    score=(score/wsum)*100;
    let grade,aura;
    if(score>=95){grade='S';aura=5;}
    else if(score>=88){grade='A+';aura=4;}
    else if(score>=78){grade='A';aura=3;}
    else if(score>=65){grade='B';aura=2;}
    else if(score>=50){grade='C';aura=1;}
    else{grade='F';aura=0;}
    return { score:Math.round(score), grade, aura };
  }
  return { gradeFrom };
})();
window.Scoring=Scoring;


// ─── THE 4 JUDGES — same 7 metrics, four temperaments. Each re-weights the
//     dimensions, applies its own curve + randomness, and talks in character. ──
const Judges = (function(){
  const DIMS=['noteChoice','timing','chordTones','space','intensity','bending','comping'];
  const ROSTER=[
    { id:'artie', name:'Artie', tag:'loose', colour:'#9AE66A',
      W:{noteChoice:0.12,timing:0.10,chordTones:0.12,space:0.18,intensity:0.20,bending:0.18,comping:0.10},
      curve:12, variance:3,
      says:{hi:["Loose and lovely, baby.","Felt good — who counts clams?","You let it breathe. I dig it.","Smooth. You weren't even trying hard.","That's the good stuff. Effortless.","Rode the groove like a hammock.","Yeah man, that just flowed.","Butter. Pure butter.","You and the beat were old friends.","Didn't think, just played. Perfect.","That had a Sunday-morning glow.","Butter on toast, that was.","You made the guitar sing, kid.","Like a good espresso, strong and smooth.","You got that lounge-singer swagger tonight.","That phrasing had real Napoli in it.","You told a story up there, kid.","That was a warm night in Napoli, right there.","You danced with the changes, kid.","That had real gravel and honey in it.","You made an old song feel brand new, kid."],
            mid:["Rough, but it had heart.","I'll allow it. Vibes carried you.","Not clean, not boring either.","Few bumps, still felt nice.","Loosen up more, it'll come.","Decent hang. No complaints here.","Almost in the pocket. Almost.","You were thinking too hard, man.","Stop counting, start feeling.","It wandered, but pleasantly.","Halfway to a hammock.","Bit rough round the edges, but it had soul.","Not bad, not bad - a little more swagger.","It's a Tuesday night set. Nothing wrong with that.","Solid. Wouldn't turn my back on it.","Decent plate of pasta, not the best I have had.","You played it safe. Safe is fine, tonight.","Not bad. Not the special, but not bad.","A little cold in the middle, warm at the end.","It's a working man's set. Gets the job done.","Steady hands, could use a little fire."],
            lo:["Still a spark in there somewhere.","Messy, but you went for it. Respect.","Heard worse on a good night.","Take a breath, try it sleepy.","No worries. Shake it off.","Rough one, but I'm not mad.","Eh, we've all had off takes.","You were tense. I could hear it.","Let it go, then play it again.","Forgiven. Music's hard, baby.","Eh, we all have off nights, cugino.","The heart was there, the hands were somewhere else.","Even Sinatra had a rough Tuesday, kid.","Hey, the bar's still open. Try again.","Eh, the sauce didn't come together.","We start again tomorrow, no shame in it.","Even the espresso machine broke that night.","We forgive it. Come back Thursday.","Even the best kitchen burns a dish sometimes.","Shake it off, the next one is yours."]}},
    { id:'billie', name:'Billie', tag:'chaos', colour:'#ff44ff',
      W:{noteChoice:0.06,timing:0.06,chordTones:0.08,space:0.10,intensity:0.30,bending:0.28,comping:0.12},
      curve:0, variance:18,
      says:{hi:["YES. Burn it down!","Unhinged. I'm obsessed.","That bend nearly took my head off.","Reckless and PERFECT.","You scared me. Do it again.","Pure adrenaline. More!","I felt that in my teeth.","FERAL. Absolutely feral. Love it.","You played like the amp owed you money.","That solo had a body count.","Loud, wrong, GLORIOUS.","KABOOM! That was UNHINGED, I loved it!","You played like your hair was on fire! MORE!","BOING! That note bounced right into my heart!","Ten out of ten, would explode again!","CONFETTI CANNON! That deserved one!","You turned that solo into a ROCKET!","SPARKLERS! I want SPARKLERS for that!","That solo had TEETH! Real teeth!","GLITTER CANNON! Full volume GLITTER!","That was a firework factory explosion, YES!"],
            mid:["Chaos needs MORE chaos.","You blinked. Never blink.","Too safe — give me danger.","Halfway feral. Go all the way.","I wanted teeth, got gums.","Push HARDER next time.","Almost dangerous. Almost.","You apologised with that note. Don't.","Some fire. I wanted an inferno.","Good. Now break the rules harder.","You flinched. I saw it.","Eh, needs more EXPLOSIONS, but okay okay.","I almost fell off my chair. ALMOST.","Meh-diocre! Get it? Meh? ...Eh.","A solid maybe-kinda-good-ish job!","Medium spicy! Could use more hot sauce!","A solid THUD, in a good way, I think!","Room temperature soda. Still fizzy-ish!","A solid maybe! MAYBE with capital letters!","A damp sparkler, but it still sparked!","Medium chaos! I wanted MORE chaos!"],
            lo:["Boring is the only crime.","Where was the RISK?!","Play like the floor's on fire.","Wake me when it gets wild.","That was a nap, not a solo.","Too polite. I'm offended.","Break something. Anything.","I've heard hold music with more guts.","Safe is the slowest death.","You played it like a seatbelt.","Snore. Set it ALIGHT next time.","Wake me up when it gets DANGEROUS!","That was a nap with strings attached, pal!","That was a whoopee cushion of a solo.","Somebody call the fun police, 'cause there wasn't any!","That was a balloon that never popped.","Even my rubber chicken played it better!","That was a wet firework. Sad little fizzle.","Even my slide whistle has more range!","That solo forgot its own name.","Even a kazoo brings more danger than that!"]}},
    { id:'howie', name:'Howie', tag:'strict', colour:'#78D4EF',
      W:{noteChoice:0.30,timing:0.26,chordTones:0.24,space:0.08,intensity:0.04,bending:0.04,comping:0.04},
      curve:-14, variance:2,
      says:{hi:["Acceptable. Barely.","Clean. Theory holds.","No wrong notes. As it should be.","Correct. I expected nothing less.","Tidy. Keep it that way.","Fine. Don't get comfortable.","Precise. Noted.","Disciplined. Rare. Continue.","The mode was respected. Good.","Structurally sound. Approved.","Now THAT is what I demand. Again.","Finally. You showed up. Do not waste it.","This is the standard. Meet it every time.","You earned that. Don't get comfortable.","This is why I show up. More of this.","You met the moment. Rare. Repeat it.","This is the bar. Everyone else, take notes.","Rare air up there. Stay in it.","That's the ceiling. Live there.","Zero notes wasted. Do it again."],
            mid:["Your time wandered. Fix it.","Two notes outside the mode. I counted.","Adequate. Not impressive.","Passable. Just.","The phrasing was lazy.","Competent, forgettable.","You can do better. Do it.","Theory was bent, not broken. Just.","The cadence was weak.","Acceptable in parts. Inconsistent.","Competent. I do not reward competent.","Halfway there. Halfway is nowhere.","Passable. I expected more from you.","You are capable of better. Prove it next time.","Fine. Fine is not what I pay attention to.","You coasted. I noticed. Do not do that again.","Serviceable. I do not applaud serviceable.","You showed flashes. Flashes are not enough.","You hovered near good. Land on it next time.","Adequate is a word I hate using."],
            lo:["Sloppy. The mode is not a suggestion.","Timing all over the place.","Sit with a metronome. Then return.","Did you practise? Be honest.","Notes outside the key. Many.","Undisciplined. Start over.","That was an audition to leave.","Fundamentals. Go back to them.","The theory wept. So did I.","Chaos is not a style. It is an error.","That was an audition to leave. Denied.","I have heard elevators with more intention.","Unacceptable. Start over, mentally.","I have heard interns play with more conviction.","That was forgettable, and I do not forget.","Try again when you mean it this time.","That would not make my cut.","I've seen better from a broken metronome.","That's a rehearsal tape, not a performance.","Come back when you mean it."]}},
    { id:'freddie', name:'Freddie', tag:'virtuoso', colour:'#A78BFA',
      W:{noteChoice:0.24,timing:0.24,chordTones:0.20,space:0.06,intensity:0.04,bending:0.14,comping:0.08},
      curve:-4, variance:1,
      says:{hi:["Every interval landed exactly where it should. I checked.","Mathematically clean. That was beautiful.","You resolved on the b3 at precisely the right instant.","Perfect pitch confirms it. Flawless.","I counted. Zero wrong notes. Zero.","That phrase had perfect internal symmetry.","The voice-leading was geometrically perfect.","118 BPM and you never drifted. Extraordinary.","The pattern was complete. Nothing was missing.","That's the most precise thing I've heard all night.","Correct. Precise. Acceptable.","The intonation held. I have no complaints.","Within tolerance. Well within tolerance.","No deviations detected. Commendable.","All targets met. No further notes.","Consistent from bar one to the last.","Zero deviation across the full pass.","Textbook. I have nothing further.","Flawless against every reference tone.","Consistent to the millisecond. Approved."],
            mid:["Bar three was 14ms early. The rest held.","You bent about 20 cents sharp. Otherwise correct.","The pattern broke on the fifth note. I noticed.","Structurally sound. Two intervals were imprecise.","Close. The G# wanted to be exactly in tune.","Timing drifted 6% in the turnaround.","Good architecture. One pitch error at the cadence.","You were nearly exact. Nearly is measurable.","The shape was right. The spacing was not.","Solid. I can list the three things to fix.","Close. The G-sharp wanted to resolve. It did not.","Adequate. Your time drifted by four percent.","Minor deviations. Acceptable for this tempo.","The average held. The peaks did not.","Trending acceptable. Watch bar seven.","Within margin, barely. Noted.","Trending within range, mostly.","The tempo drifted, then corrected. Noted.","Marginal drift, within acceptable bounds.","Two notes flat. Otherwise sound."],
            lo:["The intervals were inconsistent. I can show you which.","Pitch wandered. We can fix that — it's measurable.","The pattern had no internal logic I could follow.","Timing was unpredictable. Predictability is the goal.","Nine notes outside the set. I counted each one.","It needs structure. I happen to like structure.","Let's rebuild it precisely. I'll help.","I'm not upset. It's just incorrect, and correctable.","The maths didn't resolve. We can make it resolve.","Start with the metronome. Everything follows from time.","Bar three was fourteen milliseconds early.","The pitch center wandered. I measured it.","Deviation exceeds threshold. Recalibrate.","Multiple timing faults logged this pass.","Multiple targets missed. Data does not lie.","The pattern broke early and stayed broken.","Deviation logged at every downbeat.","The waveform tells a different story.","Deviation compounding bar over bar.","The waveform shows the truth plainly."]}},
    { id:'jackie', name:'Jackie', tag:'joker', colour:'#FF8844',
      W:{noteChoice:0.16,timing:0.14,chordTones:0.14,space:0.22,intensity:0.10,bending:0.12,comping:0.12},
      curve:0, variance:10, joker:true,
      says:{hi:["So good it is almost illegal. Almost.","I would clap but my hands are applauding.","That slapped. Felt the slap.","Chef's kiss. Mwah. Gone.","Hot. Call the fire marshal.","Tasty. Saving the leftovers.","Ten out of nine. Math's broken.","I'd frame that solo if sound had walls.","You cooked. Smoke alarm's still going.","Standing ovation. I'm sitting, but spiritually.","Ooh, tasty! Saving the leftovers!","A whole sandwich AND dessert, you fed me!","Ooh, that was a five-star buffet, honey!","Chef's kiss! No, chef's WHOLE FACE kiss!","Ooh, that's the good stuff, the VERY good stuff!","You get a gold star AND a sticker, honey!","Ooh, a whole banquet, and dessert too!","You get the gold sticker AND a hug, honey!","Ooh, a five-course meal AND a doggy bag!","You get the whole cookie jar, honey!"],
            mid:["Middle of the road — mind the traffic.","Not bad, not rad. Bad-jacent.","You and the beat are seeing other people.","Solid B-movie energy.","Half a sandwich. Still hungry.","It was fine. Fine is a place.","Parked between the lines. Barely.","A solid 'eh' with a side of 'huh'.","You waved at greatness from the bus.","Lukewarm soup. Edible soup, though.","Half a sandwich. Still a little hungry.","Snack-sized. I wanted a meal, cutie.","It's fine, it's fine, like microwave leftovers.","You get a participation trophy, sweetie.","Mm, lukewarm soup. Still soup, though.","You get a solid shrug emoji from me.","Lukewarm leftovers, but I'll eat 'em.","A solid B-minus vibe, sweetie.","Store-brand snack, still snacky though.","It's fine! It's fiiiiine, sweetie."],
            lo:["A brave, wrong choice.","My ears filed a complaint.","Even the rests sounded nervous.","That note's still running away.","Heard elevators with more groove.","The metronome ghosted you.","Bold. Wrong, but bold.","That solo and I are no longer speaking.","You played hide and seek with the key. Key won.","I've heard a fridge hum with more intent.","You gave me crumbs. CRUMBS!","I asked for a solo, not a hostage note!","Ooh, that hurt MY ears, and I'm made of tin foil jokes.","Somebody get this solo a nightlight, it is scared.","That solo called in sick, didn't it.","I have heard toasters more musical.","That solo needed a permission slip.","I have heard washing machines with more rhythm.","That solo needed a permission slip AND a nap.","Even my squeaky shoes keep better time!"]}},
  ];
  // ── BACKSTAGE BANTER — the judges squabble between verdicts. Each exchange is a short
  //    call-and-response, played for laughs. Freddie's bit is that he's exactly right and
  //    quietly the sharpest ear in the room. ──
  const BANTER=[
    [{who:'artie',text:"Howie didn't clean his ears today."},{who:'howie',text:"My ears are immaculate. Your timing is not."}],
    [{who:'billie',text:"Howie, loosen the tie before it strangles your taste."},{who:'howie',text:"The tie stays. So do my standards."}],
    [{who:'howie',text:"Billie, volume is not virtuosity."},{who:'billie',text:"Neither is a spreadsheet, sweetheart."}],
    [{who:'jackie',text:"Tough crowd. Artie's asleep, Howie's allergic to fun."},{who:'artie',text:"I'm awake. I'm just relaxed."}],
    [{who:'billie',text:"That was a MILLION notes!"},{who:'freddie',text:"It was forty-one."},{who:'billie',text:"...okay that's kind of metal, actually."}],
    [{who:'artie',text:"Freddie counted every note again."},{who:'freddie',text:"Forty-one. I'm right. I'm usually right."}],
    [{who:'howie',text:"Jackie, a joke is not a critique."},{who:'jackie',text:"And a frown is not a personality, Howie."}],
    [{who:'howie',text:"I heard two notes go flat."},{who:'freddie',text:"One. Bar three. I can show you the waveform."},{who:'howie',text:"...I'll allow the correction."}],
    [{who:'billie',text:"Jackie, fewer puns, more pyrotechnics."},{who:'jackie',text:"I contain multitudes. And puns."}],
    [{who:'artie',text:"Billie, breathe. It's music, not a bar fight."},{who:'billie',text:"Why not both?"}],
    [{who:'freddie',text:"You're all arguing about feel. Feel is just timing you haven't measured yet."},{who:'artie',text:"...that's beautiful and terrifying."}],
    [{who:'jackie',text:"Freddie, what'd you clock that solo at?"},{who:'freddie',text:"118, drifting to 121. The drift was the best part."},{who:'jackie',text:"See — even the metronome has a heart."},{who:'freddie',text:"I'm not a metronome. I just like exact numbers."}],
    [{who:'howie',text:"Finally, someone here respects precision."},{who:'freddie',text:"I respect it. You approximate it."},{who:'artie',text:"OHHH."}],
    [{who:'billie',text:"Freddie, ever played a wrong note on purpose?"},{who:'freddie',text:"Once. It was correct in a different key. I checked."}],
    [{who:'jackie',text:"Artie, wake up, we're judging."},{who:'artie',text:"I judged. I judged it lovely."}],
  ];
  // v705: TARGETED COACHING - each judge names the ONE dimension you most need to work on
  //   (their lowest-weighted-but-cared-about metric), phrased in character. 'more' if low, and a
  //   'keep' nod if everything's already strong.
  const COACH={
    noteChoice:{ artie:'lean into notes that just feel right, not just the safe ones',
                 billie:'grab scarier notes - the ugly ones that resolve', howie:'stay inside the mode; two of your notes were outside it',
                 freddie:'your note choices drifted from the harmony - target chord tones on strong beats', jackie:'pick notes like you mean them, not like you tripped over them' },
    timing:{ artie:'let it breathe, but land the downbeats', billie:'your chaos needs a pocket to explode out of',
             howie:'sit with a metronome; your time wandered', freddie:'tighten your timing - you were early on the strong beats', jackie:'you and the beat need couples counselling' },
    chordTones:{ artie:'hit a chord tone when the chord changes, then wander', billie:'anchor the madness on a chord tone now and then',
                 howie:'land on chord tones over the changes - you floated past them', freddie:'resolve to chord tones on the changes; you left them hanging', jackie:'aim for the target notes, not their neighbours' },
    space:{ artie:'you already breathe well - keep leaving room', billie:'less silence, more noise - fill the gaps with fire',
            howie:'more rests; you crowded the phrase', freddie:'add space - phrases need silence to read as phrases', jackie:'give the notes some personal space' },
    intensity:{ artie:'push a little harder in the peaks', billie:'MORE. Louder, wilder, meaner',
                howie:'dynamics are fine; focus elsewhere', freddie:'vary your intensity - it was flat across the solo', jackie:'turn something up before I fall asleep' },
    bending:{ artie:'a bend or two would add some cry', billie:'bend till it screams, then bend more',
              howie:'your bends landed flat - hit the target pitch', freddie:'your bends were about 20 cents sharp - pull back slightly', jackie:'bend it like you owe it money' },
    comping:{ artie:'work the rhythm under the line more', billie:'stab some chords between the runs',
              howie:'your comping was thin - support the line', freddie:'add rhythmic support; the middle voices were empty', jackie:'back yourself up - it is a solo, not a hostage situation' }
  };
  // v710: on a GOOD score, praise the strongest dimension instead of nagging - no more negative
  //   critique over a positive grade.
  const PRAISE={
    noteChoice:{ artie:'your note choices felt right all the way through', billie:'those note choices had bite', howie:'clean note choices - all inside the mode', freddie:'your note choices tracked the harmony exactly', jackie:'you picked winners' },
    timing:{ artie:'the groove sat beautifully', billie:'the timing rode the chaos perfectly', howie:'your timing held - good', freddie:'your timing was tight to the beat', jackie:'you and the beat are back together' },
    chordTones:{ artie:'you landed the changes and still wandered free', billie:'anchored the madness right on the chords', howie:'chord tones nailed over the changes', freddie:'you resolved to chord tones exactly on the changes', jackie:'bullseye on the target notes' },
    space:{ artie:'you let it breathe - lovely', billie:'the space made the loud parts hit harder', howie:'well-judged rests', freddie:'your phrasing had proper space', jackie:'the notes had room to party' },
    intensity:{ artie:'the peaks pushed just right', billie:'YES - that intensity!', howie:'good dynamic control', freddie:'nice intensity arc across the solo', jackie:'you brought the heat' },
    bending:{ artie:'those bends had real cry', billie:'the bends SCREAMED', howie:'bends landed on pitch', freddie:'your bends hit the target pitch cleanly', jackie:'you bent it like you meant it' },
    comping:{ artie:'the rhythm underneath was working', billie:'those chord stabs punched through', howie:'solid comping support', freddie:'good rhythmic support in the middle voices', jackie:'you had your own back' }
  };
  function praiseLine(jid, m, W){
    var best=null, bestScore=-1;
    for(var k in W){ var val=(m[k]||0)*W[k]; if(val>bestScore){ bestScore=val; best=k; } }
    if(best==null) return '';
    var lib=PRAISE[best]; return lib?(lib[jid]||''):'';
  }
  function coachLine(jid, m, W){
    // the dimension this judge cares about most that scored lowest
    var worst=null, worstScore=999;
    for(var k in W){ var val=(m[k]||0); var care=W[k];
      var eff = val*100 - (1-care)*10;   // weight by how much this judge cares
      if(eff<worstScore){ worstScore=eff; worst=k; } }
    if(worst==null) return '';
    var lib=COACH[worst]; if(!lib) return '';
    return lib[jid]||'';
  }
  function tier(s){ return s>=85?'hi':s>=60?'mid':'lo'; }
  function letter(s){ return s>=95?'S':s>=88?'A+':s>=78?'A':s>=65?'B':s>=50?'C':'F'; }
  function pick(a,seed){ return a[Math.floor(Math.abs(seed))%a.length]; }
  function nameOf(id){ const j=ROSTER.find(function(r){return r.id===id;}); return j?j.name:id; }
  function colourOf(id){ const j=ROSTER.find(function(r){return r.id===id;}); return j?j.colour:'#bbb'; }
  // ~40% of verdicts, return a short squabble as [{name,colour,text},...]; else null
  function argument(){
    if(Math.random()>=0.4) return null;
    const ex=BANTER[Math.floor(Math.random()*BANTER.length)];
    return ex.map(function(line){ return { name:nameOf(line.who), colour:colourOf(line.who), text:line.text }; });
  }
  function verdicts(metrics){
    const m=Object.assign({timing:0,noteChoice:0,chordTones:0,bending:0,space:0,intensity:0,comping:0},metrics||{});
    const v=ROSTER.map(function(j){
      let s=0,w=0; for(const k of DIMS){ s+=(m[k]||0)*j.W[k]; w+=j.W[k]; }
      s=(s/w)*100+j.curve;
      if(j.variance) s+=(Math.random()*2-1)*j.variance;
      if(j.joker && Math.random()<0.15) s=100-s;            // Jackie flips ~15% of the time
      s=Math.max(0,Math.min(100,Math.round(s)));
      const seed=s*7+(m.noteChoice||0)*13+(m.timing||0)*5;
      var _good = s>=78;
      var _cl = _good ? praiseLine(j.id, m, j.W) : coachLine(j.id, m, j.W);
      return { id:j.id,name:j.name,tag:j.tag,colour:j.colour,score:s,grade:letter(s),comment:pick(j.says[tier(s)],seed), coach:_cl, coachKind:(_good?'praise':'work') };
    });
    const topGrade=v.some(function(r){ return r.id!=='jackie'&&r.score>=78; });
    if(topGrade){ const ji=v.findIndex(function(r){return r.id==='jackie';}); if(ji>=0&&v[ji].score<50){ const cs=50+Math.floor(Math.random()*12); v[ji].score=cs; v[ji].grade=letter(cs); v[ji].comment=pick(ROSTER[ji].says.mid,cs*3); } }
    return v;
  }
  return { verdicts, argument, ROSTER };
})();


// ── UNLOCK TOKENS — the in-app currency. Earned from aura level-ups, spent to unlock
//    individual backing tracks and sample packs. (Instant Buy bypasses tokens for real money.) ──
const Tokens = (function(){
  let bal=0;
  try{ bal=parseInt(localStorage.getItem('improvs2_tokens')||'0',10)||0; }catch(e){}
  function save(){ try{ localStorage.setItem('improvs2_tokens', String(bal)); }catch(e){} }
  function render(){ const el=document.getElementById('currTokens'); if(el) el.textContent=bal; }
  return {
    get balance(){ return bal; },
    add(n){ bal+=n; save(); render(); },
    spend(n){ if(bal<n) return false; bal-=n; save(); render(); return true; },
    render
  };
})();
// ── GEMS — premium currency bought with real money via Google Play IAP. Gems are
//    spent on backing-track packs and loot packs. No refunds on gems (store policy);
//    selling gems rather than tracks insulates from "didn't like the track" refunds.
//    Earned-by-grinding-aura is handled separately (packs can also be claimed with aura).
const Gems = (function(){
  let bal=0;
  try{ bal=parseInt(localStorage.getItem('improvs2_gems')||'0',10)||0; }catch(e){}
  function save(){ try{ localStorage.setItem('improvs2_gems', String(bal)); }catch(e){} }
  // Gem store packs (real-money). Prices come from Google Play at runtime; amounts are fixed.
  const PACKS=[
    {id:'gems_100',  gems:100,  price:'$0.99'},
    {id:'gems_550',  gems:550,  price:'$4.99',  bonus:'+10%'},
    {id:'gems_1200', gems:1200, price:'$9.99',  bonus:'+20%'},
    {id:'gems_2500', gems:2500, price:'$19.99', bonus:'+25%'}
  ];
  function render(){
    const el=document.getElementById('gemCount'); if(el) el.textContent=bal;
    const chip=document.getElementById('gemChip'); if(chip) chip.style.boxShadow = bal>0 ? '0 0 8px #22d3ee88' : 'none';
    const cel=document.getElementById('currGems'); if(cel) cel.textContent=bal;
  }
  // Overlay store — NOT confirm() (ACode WebView swallows confirm). Each tier routes
  //   through the native IAP on tap; the stub credits gems so the flow is testable.
  function openStore(){
    let ov=document.getElementById('gemStoreOverlay');
    if(ov) ov.remove();
    ov=document.createElement('div');
    ov.id='gemStoreOverlay';
    ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;font-family:Bangers,cursive;';
    let html='<div style="color:#22d3ee;font-size:1.2em;letter-spacing:2px;text-shadow:0 0 12px #22d3ee99;">💎 GET GEMS</div>'
      +'<div style="color:#9ca3af;font-size:0.7em;max-width:300px;text-align:center;line-height:1.4;">Gems buy backing-track packs &amp; loot. Prices shown by Google Play. No refunds on gems.</div>';
    try{
      if(window.AdEngine && AdEngine.rewGems){
        const g=AdEngine.rewGems();
        if(g.enabled){
          const can=g.left>0;
          html+='<button id="gemAdBtn" '+(can?'':'disabled')+' style="display:flex;align-items:center;justify-content:space-between;gap:14px;width:260px;padding:12px 18px;background:'+(can?'linear-gradient(135deg,#065f46,#064e3b)':'#1a2028')+';border:1px solid '+(can?'#34d399':'#333c48')+';border-radius:10px;color:'+(can?'#d1fae5':'#5b6472')+';font-family:inherit;letter-spacing:1px;cursor:'+(can?'pointer':'default')+';">'
            +'<span>\ud83c\udfac WATCH AD <span style="font-size:0.68em;opacity:0.8;">'+(can?(g.left+'/'+g.cap+' today'):'back tomorrow')+'</span></span>'
            +'<span style="color:#a7f3d0;">+'+g.amount+' \ud83d\udc8e FREE</span></button>';
        }
      }
    }catch(e){}
    PACKS.forEach(p=>{
      html+='<button data-gembuy="'+p.id+'" style="display:flex;align-items:center;justify-content:space-between;gap:14px;width:260px;padding:12px 18px;background:linear-gradient(135deg,#0e7490,#155e75);color:#fff;border:1px solid #22d3ee;border-radius:10px;font-family:Bangers,cursive;font-size:0.95em;letter-spacing:1px;cursor:pointer;">'
        +'<span>💎 '+p.gems+(p.bonus?' <span style="color:#fde68a;font-size:0.7em;">'+p.bonus+'</span>':'')+'</span>'
        +'<span style="color:#a7f3d0;">'+p.price+'</span></button>';
    });
    html+='<button id="gemStoreClose" style="margin-top:8px;padding:8px 26px;background:#374151;color:#fff;border:none;border-radius:8px;font-family:Bangers,cursive;font-size:0.85em;letter-spacing:1px;cursor:pointer;">CLOSE</button>';
    ov.innerHTML=html;
    document.body.appendChild(ov);
    ov.querySelector('#gemStoreClose').onclick=()=>ov.remove();
    ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
    const gab=ov.querySelector('#gemAdBtn');
    if(gab && !gab.disabled) gab.onclick=()=>{ ov.remove(); try{ AdEngine.redeemRewGems(); }catch(e){} };
    ov.querySelectorAll('[data-gembuy]').forEach(b=>b.addEventListener('click',()=>{
      const p=PACKS.find(x=>x.id===b.dataset.gembuy); if(!p) return;
      // native IAP hook; stub credits gems so the purchase→credit flow is testable end-to-end
      let done=false;
      try{ if(typeof AdManager!=='undefined' && AdManager.purchase){ done=AdManager.purchase(p.id); } }catch(e){}
      bal+=p.gems; save(); render();
      console.log('[GEMS] purchased '+p.id+' (+'+p.gems+' gems, native:'+done+')');
      ov.remove();
      try{ flashAurora('#22d3ee', 0.6, 1600); }catch(e){}
    }));
  }
  return {
    get balance(){ return bal; },
    add(n){ bal+=n; save(); render(); },
    spend(n){ if(bal<n) return false; bal-=n; save(); render(); return true; },
    openStore, render
  };
})();

// ── TOKEN → GEM TRADE — one-way, 1 token = 15 gems. Direct token-spend on packs stays
//    the better value (a 15-token pack would be 225 gems here, under the 300-gem price),
//    so the trade is a convenience for token-rich players, not an exploit. ──
window.openTokenTrade=function(){
  const RATE=15;
  let ov=document.getElementById('tokenTradeOv'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='tokenTradeOv';
  ov.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Bangers,cursive;';
  let n=1;
  const maxTok=()=>Math.max(0, Tokens.balance);
  function draw(){
    const mx=maxTok(); if(n>mx) n=mx; if(n<1) n=Math.min(1,mx||1);
    ov.innerHTML='<div style="background:#15131c;border:2px solid #7c3aed;border-radius:14px;max-width:300px;width:100%;padding:20px;text-align:center;">'
      +'<div style="color:#c4b5fd;font-size:1.15em;letter-spacing:2px;margin-bottom:4px;">TRADE</div>'
      +'<div style="color:#9aa;font-size:0.6em;font-family:sans-serif;margin-bottom:12px;">1 🎟 = '+RATE+' 💎 · one-way. Spending tokens on packs is better value.</div>'
      +'<div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px;">'
        +'<button id="ttMinus" style="width:40px;height:40px;border-radius:8px;background:#3b2a6b;color:#fff;border:1px solid #7c3aed;font-size:1.4em;font-family:inherit;cursor:pointer;">–</button>'
        +'<div style="min-width:70px;color:#fff;font-size:1.5em;">'+n+' 🎟</div>'
        +'<button id="ttPlus" style="width:40px;height:40px;border-radius:8px;background:#3b2a6b;color:#fff;border:1px solid #7c3aed;font-size:1.4em;font-family:inherit;cursor:pointer;">+</button>'
      +'</div>'
      +'<div style="color:#67e8f9;font-size:1.2em;margin-bottom:4px;">→ '+(n*RATE)+' 💎</div>'
      +'<div style="color:#9aa;font-size:0.58em;font-family:sans-serif;margin-bottom:14px;">you have '+mx+' 🎟 · '+Gems.balance+' 💎</div>'
      +'<div style="display:flex;gap:8px;">'
        +'<button id="ttGo" style="flex:1;padding:11px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:0.95em;cursor:pointer;'+(mx<1?'opacity:0.4;pointer-events:none;':'')+'">CONFIRM</button>'
        +'<button id="ttX" style="flex:1;padding:11px;background:#374151;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:0.95em;cursor:pointer;">CLOSE</button>'
      +'</div></div>';
    ov.querySelector('#ttMinus').onclick=function(){ if(n>1){n--;draw();} };
    ov.querySelector('#ttPlus').onclick=function(){ if(n<maxTok()){n++;draw();} };
    ov.querySelector('#ttX').onclick=function(){ ov.remove(); };
    const go=ov.querySelector('#ttGo'); if(go) go.onclick=function(){
      if(Tokens.spend(n)){ Gems.add(n*RATE); try{flashAurora('#22d3ee',0.6,1500);}catch(e){} n=1; draw(); }
    };
  }
  draw(); document.body.appendChild(ov);
};

// ── TRACK PACKS — 6 backing tracks sold as one pack, shown as a spinning hexagon disc.
//    Swipe/drag to rotate to each track; the disc tints to the key-colour of the pack's
//    lead song. Bought with gems or claimed by grinding aura. ──
const TrackPacks = (function(){
  // v466: strip a minor/major suffix off a track key → bare root for colour/index lookups
  const _KROOT=k=>String(k||'').trim().replace(/(?:maj|min|m)$/i,'');
  // v470: wedge colour = the SCALE's signature colour — the exact sigMixFor() blend the
  //   boards/shields use. "G"  → G IONIAN signature (pale mauve)
  //                       "Gm" → G AEOLIAN signature (rose)
  //   Falls back to the tonic colour only if the global mixer is unavailable.
  const _KEYCOL=k=>{
    try{
      const raw=String(k||'').trim();
      const min=/min$/i.test(raw) || /[A-G](?:#|b)?m$/i.test(raw);
      const root=_KROOT(raw), mode=min?'AEOLIAN':'IONIAN';
      if(typeof sigMixFor==='function' && typeof MODE_SEMITONES!=='undefined' && MODE_SEMITONES[mode]){
        const h=sigMixFor(root, mode, 'NA', MODE_SEMITONES[mode]);
        if(h && h!=='#888888') return h;
      }
    }catch(e){}
    const i=_KN.indexOf(_KROOT(k));
    return i>=0?_KC[i]:'#558BE1';
  };
  // Each pack = 6 tracks. leadKey sets the disc tint. priceGems = gem cost · auraCost =
  //   grind-to-earn cost. A track may carry chord data (prog) and/or a real audio file
  //   (audioUrl) — the engine plays whichever is present. Tracks get a stable id (packId#n)
  //   so playback + unlock tracking work for built-in AND DLC packs.
  const BUILTIN_PACKS=[];   // packs stream from GitHub (tracks.json); nothing hardcoded here

  // ── DLC PACK LOADING ──────────────────────────────────────────────────────────
  //  The core app is frozen once shipped. New packs arrive as DLC — added WITHOUT
  //  editing this file, exactly like the external chess DBs:
  //   • NOW: drop a pack file in the app folder that sets window.__TRACK_PACKS = [ ... ].
  //          It's merged on load. (Loaded via <script> tag, works offline.)
  //   • LATER: TrackPacks.loadFromURL(url) fetches a JSON manifest and merges it
  //          (for a remote pack store / GitHub release — needs network).
  //  Either way a pack is the same shape as BUILTIN_PACKS above.
  let EXTERNAL=[];
  function normPack(p){
    if(!p||!p.tracks) return null;
    // give each track a stable id so playback + ownership work
    p.tracks.forEach((t,i)=>{ if(!t.id) t.id=p.id+'#'+i; });
    return p;
  }
  function mergeExternal(arr){
    if(!Array.isArray(arr)) return;
    arr.forEach(p=>{ const n=normPack(p); if(n && !allPacks().some(x=>x.id===n.id)) EXTERNAL.push(n); });
  }
  function allPacks(){ return BUILTIN_PACKS.concat(EXTERNAL); }
  // pick up a folder-dropped pack file (set before or after this script loads)
  function ingestGlobal(){ try{ if(window.__TRACK_PACKS) mergeExternal(window.__TRACK_PACKS); }catch(e){} }
  // remote manifest (used post-launch for a pack store; no-op offline)
  function loadFromURL(url){
    return fetch(url).then(r=>r.json()).then(j=>{
      // resolve a short per-track `file` against the manifest's `base` (CDN) into a full audioUrl.
      //   Leaves an explicit audioUrl untouched; plain-array manifests still work.
      const base=(j&&j.base)||'';
      const packs=Array.isArray(j)?j:(j.packs||[]);
      packs.forEach(p=>{ if(p&&Array.isArray(p.tracks)) p.tracks.forEach(t=>{
        if(!t.audioUrl){ if(t.file) t.audioUrl=base+t.file; else if(t.url) t.audioUrl=t.url; }
      }); });
      mergeExternal(packs); render(); return true;
    }).catch(e=>{ console.log('[PACK] manifest load failed:',e&&e.message); return false; });
  }
  // normalise built-ins' track ids up front
  BUILTIN_PACKS.forEach(normPack);
  ingestGlobal();

  // Self-contained lookup tables — NOTES/HEX_MAP are const in a different <script> block
  //   so they are NOT reachable here. Embedding them avoids the silent ReferenceError fallback.
  const _KN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const _KC=['#EDF0CF','#9AE66A','#00CC66','#78E1B7','#78D4EF','#558BE1','#1B1B1C','#AE78C6','#DD6EBB','#F0483A','#FF8844','#FFDD00'];
  function noteColour(key){ const i=_KN.indexOf(key); return i>=0?_KC[i]:'#558BE1'; }
  function packKey(pack){
    try{
      // explicit leadKey from tracks.json still wins — "Em"/"Gm" valid.
      if(pack.leadKey && _KN.indexOf(_KROOT(pack.leadKey))>=0) return String(pack.leadKey).trim();
      // v473: the pack key = the CLOSEST of the 24 ionian/aeolian keys to the songs' tonic
      // roots (same rule as per-song keys, applied at pack level). Scoring per song root:
      //   exact key match +100 · parallel tonic +40 · root on I/IV/V of candidate +25 ·
      //   other diatonic degree +15 · +10 when the song's quality matches the diatonic
      //   chord quality at that degree. Degree-modes fold to the parent by construction
      //   (dorian=iv, phrygian=v of aeolian; lydian=IV, mixolydian=V of ionian — same set).
      // Ties: more exact-key songs → the opening track's key → lowest chromatic index.
      const ION={semis:[0,2,4,5,7,9,11], qual:['M','m','m','M','M','m','d']};
      const AEO={semis:[0,2,3,5,7,8,10], qual:['m','d','M','m','m','M','M']};
      const songs=(pack.tracks||[]).map(t=>{
        const raw=String(t.key||'').trim();
        const min=/min$/i.test(raw)||/[A-G](?:#|b)?m$/i.test(raw);
        const r=_KN.indexOf(_KROOT(raw));
        return r>=0?{r,min}:null;
      }).filter(Boolean);
      if(!songs.length) return 'C';
      let best=null;
      for(let T=0;T<12;T++) for(const q of [ION,AEO]){
        const aeo=(q===AEO); let score=0, exact=0;
        for(const sg of songs){
          if(sg.r===T){ if(sg.min===aeo){ score+=100; exact++; } else score+=40; continue; }
          const d=(sg.r-T+12)%12, di=q.semis.indexOf(d);
          if(di<0) continue;
          let pts=(d===0||d===5||d===7)?25:15;
          const dq=q.qual[di];
          if((sg.min&&dq==='m')||(!sg.min&&dq==='M')) pts+=10;
          score+=pts;
        }
        const kn=_KN[T]+(aeo?'m':'');
        if(!best){ best={kn,score,exact}; continue; }
        if(score>best.score){ best={kn,score,exact}; continue; }
        if(score===best.score){
          if(exact>best.exact){ best={kn,score,exact}; continue; }
          if(exact===best.exact){
            const op=songs[0], opKey=_KN[op.r]+(op.min?'m':'');
            if(kn===opKey && best.kn!==opKey) best={kn,score,exact};
          }
        }
      }
      return best.kn;
    }catch(e){ return pack.leadKey||'C'; }
  }
  function isUnlocked(id){
    try{ return JSON.parse(localStorage.getItem('improvs2_trackpacks')||'[]').includes(id); }catch(e){ return false; }
  }
  function unlock(id){
    try{ const u=JSON.parse(localStorage.getItem('improvs2_trackpacks')||'[]'); if(!u.includes(id)){u.push(id);localStorage.setItem('improvs2_trackpacks',JSON.stringify(u));} }catch(e){}
  }
  // ── PRICING LADDER (v563) ────────────────────────────────────────────────────
  //   Per-track cost must DESCEND: single track > pack > bundle. Verified at every
  //   gem tier ($0.99/100 entry .. $19.99/2500).
  //     1 track  =  60 gems            -> 60 gems / track
  //     1 pack   = 300 gems (6 tracks) -> 50 gems / track   (17% cheaper than singles)
  //     bundles  = USD, cheaper still  (see BUNDLES: 33-44% under the gem price)
  //   Tokens are EARNED, never bought: 15 tokens/pack (= 225 gems at 1 tok : 15 gems),
  //   a 25% loyalty discount that can't be reached with cash.
  const TRACK_GEMS=60;
  // per-track single unlock (bought with a rare token or gems) — stored separately from pack ownership
  function isTrackUnlocked(trackId){
    try{ return JSON.parse(localStorage.getItem('improvs2_singletracks')||'[]').includes(trackId); }catch(e){ return false; }
  }
  function unlockSingleTrack(trackId){
    try{ const u=JSON.parse(localStorage.getItem('improvs2_singletracks')||'[]'); if(!u.includes(trackId)){u.push(trackId);localStorage.setItem('improvs2_singletracks',JSON.stringify(u));} }catch(e){}
  }
  // a track is accessible if the whole pack is owned OR the individual track was bought
  function canPlay(pack, track){
    if(window.__jamSharedUnlock) return true; // live jam shared track — locked OK for joiners
    return isUnlocked(pack.id) || isTrackUnlocked(track.id);
  }

  // ── disc rotation state ──
  let curPack=0, sel=0, angle=0;          // sel = selected track index (0..5); angle in deg
  const STEP=60;                          // 360/6 — degrees between track faces

  function buildDisc(pack){
    // a real 6-sided hexagon (flat top), tinted to the lead key. The 6 tracks sit on the
    // 6 faces; the whole hexagon rotates and visibly tilts. Each face's title counter-rotates
    // so it stays upright, and whichever face is at the top pointer is the selected track.
    const key=packKey(pack);
    const tint=_KEYCOL(key);   // v472: hub speaks the same scale-colour language as the wedges
    let segs='', spokes='';
    pack.tracks.forEach((t,i)=>{
      const c=_KEYCOL(t.key);
      // face sits at i*60° on the hexagon edge; inner content counter-rotates to read upright
      segs+='<div class="hexpack-seg" data-segrot="'+(i*STEP)+'" style="transform:rotate('+(i*STEP)+'deg) translateY(-72px);">'
        +'<div class="hexpack-seg-inner">'
          +'<div class="hexpack-seg-dot" style="background:'+c+';"></div>'
          +'<div class="hexpack-seg-ttl">'+t.title+'<br><span style="opacity:.75;">'+keyLabel(t.key)+' · '+t.bpm+'</span></div>'
        +'</div></div>';
      // a spoke to each hexagon corner (corners sit between faces, at i*60+30°)
      spokes+='<div class="hexpack-spoke" style="transform:translateX(-50%) rotate('+(i*STEP+30)+'deg);"></div>';
    });
    // hub = 6 triangular wedges fanning from centre, each coloured to its track's key.
    //   Wedge i is centred on the same i*60° bearing where track i sits (top = i0, going CW),
    //   so the top wedge matches the top track's colour, etc. SVG; 0° points up.
    const R=43, CX=43, CY=43;
    function wedgePath(idx){
      // wedge spans the 60° arc centred on idx*60° (measured from top, clockwise)
      const a0=(idx*STEP-30-90)*Math.PI/180, a1=(idx*STEP+30-90)*Math.PI/180;
      const x0=CX+R*Math.cos(a0), y0=CY+R*Math.sin(a0);
      const x1=CX+R*Math.cos(a1), y1=CY+R*Math.sin(a1);
      return 'M'+CX+' '+CY+' L'+x0.toFixed(2)+' '+y0.toFixed(2)+' L'+x1.toFixed(2)+' '+y1.toFixed(2)+' Z';
    }
    let wedges='';
    pack.tracks.forEach((t,i)=>{ const c=_KEYCOL(t.key);
      wedges+='<path d="'+wedgePath(i)+'" fill="'+c+'" stroke="#0a0a0a" stroke-width="1.2"/>'; });
    const hubSvg='<svg viewBox="0 0 86 86" width="86" height="86" style="position:absolute;inset:0;">'+wedges
      +'<circle cx="43" cy="43" r="20" fill="#0a0a0aef" stroke="'+tint+'" stroke-width="2"/></svg>';
    // the hexagon body fill — a directional sheen of the key colour so rotation is readable
    return '<div class="hexpack-pointer"></div>'
      +'<div class="hexpack-disc" id="hexDisc">'
        +'<div class="hexpack-body" style="background:'+tint+';"></div>'
        +spokes
        +segs
      +'</div>'
      +'<div class="hexpack-hub" style="background:transparent;border:none;box-shadow:none;overflow:visible;">'
        +hubSvg
        +'<div class="hexpack-hub-key" style="position:relative;z-index:2;color:'+tint+';text-shadow:0 0 8px '+tint+'88,0 1px 3px #000;">'
        +(/m$/i.test(String(key)) ? String(key).replace(/m$/i,'')+'<span style="display:block;font-size:0.34em;letter-spacing:1px;line-height:1;margin-top:1px;">MINOR</span>' : key)
      +'</div>'
        +'<div class="hexpack-hub-sub" style="position:relative;z-index:2;">'+pack.name+'</div>'
      +'</div>';
  }

  // counter-rotate each face's inner content by -(disc angle + its placement) so text stays upright.
  //   RAF-batched so pointermove doesn't thrash the DOM on every pixel moved.
  let _rafId=null;
  function uprightTitles(disc){
    if(!disc) disc=document.getElementById('hexDisc');
    if(!disc) return;
    disc.querySelectorAll('.hexpack-seg').forEach(seg=>{
      const own=parseFloat(seg.getAttribute('data-segrot'))||0;
      const inner=seg.querySelector('.hexpack-seg-inner');
      if(inner) inner.style.transform='translate(-50%,-50%) rotate('+(-(angle+own))+'deg)';
    });
  }
  function applyAngle(animated){
    const disc=document.getElementById('hexDisc'); if(!disc) return;
    disc.classList.toggle('dragging', !animated);
    disc.style.transform='rotate('+angle+'deg)';
    if(_rafId) cancelAnimationFrame(_rafId);
    _rafId=requestAnimationFrame(()=>{ _rafId=null; uprightTitles(disc); });
  }
  function selectIndex(i, animated){
    stopPreview();
    const pack=allPacks()[curPack];
    sel=((i%6)+6)%6;
    // rotate disc so face `sel` lands at top (top = -sel*STEP)
    angle=-sel*STEP;
    applyAngle(animated!==false);
    updateSel();
  }
  // ── 20-second audio preview — streams audioUrl, auto-stops after 20s ──
  let _prevSrc=null, _prevTimer=null;
  function stopPreview(){
    if(_prevTimer){ clearTimeout(_prevTimer); _prevTimer=null; }
    if(_prevSrc){ try{_prevSrc.stop();}catch(e){} _prevSrc=null; }
    // reset any preview button label
    const pb=document.getElementById('hexpackPrev20'); if(pb) pb.textContent='▶ 20s';
  }
  function playPreview(t){
    stopPreview();
    if(!t||!t.audioUrl){ return; }
    const btn=document.getElementById('hexpackPrev20'); if(btn) btn.textContent='⏹ stop';
    try{
      window.ensureAudio(); const ac=window.getAC&&window.getAC(); if(!ac) return;
      fetch(t.audioUrl).then(r=>r.arrayBuffer()).then(ab=>ac.decodeAudioData(ab)).then(buf=>{
        if(_prevSrc) return;   // a new preview started while we were decoding — bail
        const s=ac.createBufferSource(); s.buffer=buf;
        s.connect((window.getBkGain&&window.getBkGain())||ac.destination);
        s.start(); _prevSrc=s;
        _prevTimer=setTimeout(()=>{ stopPreview(); updateSel(); }, 20000);
        s.onended=()=>{ if(_prevSrc===s){ _prevSrc=null; stopPreview(); updateSel(); } };
      }).catch(e=>{ console.log('[PREVIEW] failed:',e&&e.message); if(btn) btn.textContent='▶ 20s'; });
    }catch(e){ if(btn) btn.textContent='▶ 20s'; }
  }
  function updateSel(){
    const pack=allPacks()[curPack], t=pack.tracks[sel];
    const ttl=document.getElementById('hexpackSelTtl'), meta=document.getElementById('hexpackSelMeta');
    if(ttl) ttl.textContent=t.title;
    if(meta) meta.textContent='KEY '+keyLabel(t.key)+'  ·  '+t.bpm+' BPM';
    const dots=document.getElementById('hexpackDots');
    if(dots) dots.querySelectorAll('span').forEach((d,i)=>d.classList.toggle('on',i===sel));
    const hasAudio=!!(t.audioUrl);
    const prevBtnHtml=hasAudio
      ?'<button id="hexpackPrev20" style="padding:8px 12px;background:#1a1a2e;color:#a78bfa;border:1px solid #7c3aed;border-radius:8px;font-family:Bangers,cursive;font-size:0.82em;letter-spacing:1px;cursor:pointer;">▶ 20s</button>'
      :'';
    // pack-level buy/claim state
    const buyWrap=document.getElementById('hexpackActions');
    if(buyWrap){
      if(canPlay(pack,t)){
        const cur=window.BackingTracks&&window.BackingTracks.getCurrentTrack?window.BackingTracks.getCurrentTrack():null;
        const playing=cur&&cur.id===t.id;
        buyWrap.innerHTML=
          prevBtnHtml
          +'<button id="hexpackPlay" style="padding:8px 18px;background:'+(playing?'#dc2626':'linear-gradient(135deg,#0e7490,#155e75)')+';color:#fff;border:1px solid '+(playing?'#f87171':'#22d3ee')+';border-radius:8px;font-family:Bangers,cursive;font-size:0.84em;letter-spacing:1px;cursor:pointer;">'+(playing?'■ STOP':'▶ LOAD TO FRETBOARD')+'</button>'
          +'<label id="hexpackSyncWrap" data-tip-title="SYNC METRONOME" data-tip="When loading a track, also start the metronome at the track\'s BPM. Your time signature (e.g. 3/4) is not changed." style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;background:#101826;border:1px solid #334155;border-radius:8px;font-family:Bangers,cursive;font-size:0.78em;letter-spacing:1px;color:#7eb0ff;cursor:pointer;"><input type="checkbox" id="hexpackSync" style="width:16px;height:16px;accent-color:#22d3ee;cursor:pointer;">SYNC</label>';
        const pb=document.getElementById('hexpackPlay'); if(pb) pb.onclick=()=>{ stopPreview(); playSelected(); };
        // restore SYNC checkbox state from storage
        const syncBox=document.getElementById('hexpackSync');
        if(syncBox){ try{ syncBox.checked=localStorage.getItem('improvs2_sync_met')==='1'; }catch(e){}
          syncBox.addEventListener('change',()=>{ try{ localStorage.setItem('improvs2_sync_met', syncBox.checked?'1':'0'); }catch(e){} }); }
      } else {
        const hasRare=typeof Loot!=='undefined'&&Loot.rareTokens>0;
        const canGemTrack=(typeof Gems!=='undefined'&&Gems.balance>=TRACK_GEMS);
        buyWrap.innerHTML=
          prevBtnHtml
          +(hasRare
            ?'<button id="hexpackBuySingle" style="padding:8px 14px;background:#1e3a8a;color:#93c5fd;border:1px solid #3b82f6;border-radius:8px;font-family:Bangers,cursive;font-size:0.72em;letter-spacing:1px;">\uD83D\uDD37 1 TRACK</button>'
            :'')
          +'<button id="hexpackBuyTrackGems" '+(canGemTrack?'':'disabled')+' style="padding:8px 14px;background:'+(canGemTrack?'#0b3b47':'#1a2028')+';color:'+(canGemTrack?'#67e8f9':'#4b5563')+';border:1px solid '+(canGemTrack?'#22d3ee':'#333c48')+';border-radius:8px;font-family:Bangers,cursive;font-size:0.72em;letter-spacing:1px;">\uD83D\uDC8E '+TRACK_GEMS+' \u00b7 1 TRACK</button>'
          +'<button id="hexpackBuyGems" style="padding:8px 16px;background:linear-gradient(135deg,#0e7490,#155e75);color:#fff;border:1px solid #22d3ee;border-radius:8px;font-family:Bangers,cursive;font-size:0.78em;letter-spacing:1px;">\uD83D\uDC8E '+pack.priceGems+' \u00b7 PACK</button>'
          +'<button id="hexpackBuyTokens" style="padding:8px 16px;background:#5b21b6;color:#fff;border:1px solid #7c3aed;border-radius:8px;font-family:Bangers,cursive;font-size:0.78em;letter-spacing:1px;">\uD83C\uDF9F '+pack.priceTokens+' \u00b7 PACK</button>';
        const bs=document.getElementById('hexpackBuySingle');
        if(bs) bs.onclick=()=>{
          if(typeof Loot==='undefined'||!Loot.spendRare(1)){ alert('No rare tokens. Earn them from loot chests.'); return; }
          unlockSingleTrack(t.id);
          try{ window.autoSaveBackup('single-track:'+t.id); }catch(e){}
          updateSel();
          try{ flashAurora(_KEYCOL(t.key),0.5,1200); }catch(e){}
        };
        // v563: buy ONE track with gems. Deliberately the worst gems-per-track rate —
        //   it exists so the pack (and then the bundle) is visibly the better deal.
        const btg=document.getElementById('hexpackBuyTrackGems');
        if(btg && !btg.disabled) btg.onclick=()=>{
          if(typeof Gems==='undefined'||!Gems.spend(TRACK_GEMS)){ alert('Not enough gems. Need '+TRACK_GEMS+'.'); return; }
          unlockSingleTrack(t.id);
          try{ window.autoSaveBackup('single-track-gems:'+t.id); }catch(e){}
          updateSel();
          try{ flashAurora(_KEYCOL(t.key),0.5,1200); }catch(e){}
        };
        const bg=document.getElementById('hexpackBuyGems'); if(bg) bg.onclick=()=>buyWithGems();
        const bt=document.getElementById('hexpackBuyTokens'); if(bt) bt.onclick=()=>buyWithTokens();
      }
      // wire preview button (same element in both states)
      const p20=document.getElementById('hexpackPrev20');
      if(p20) p20.onclick=()=>{ if(_prevSrc){ stopPreview(); updateSel(); } else playPreview(t); };
    }
  }
  // load the selected face's track onto the fretboard via the real backing-track engine
  function playSelected(){
    const pack=allPacks()[curPack], t=pack.tracks[sel];
    if(!canPlay(pack,t)) return;
    let started=false;
    try{
      const cur=window.BackingTracks&&window.BackingTracks.getCurrentTrack?window.BackingTracks.getCurrentTrack():null;
      if(cur&&cur.id===t.id){
        // v774: STOP must kill track + metronome/walk (was leaving click running)
        try{ window.BackingTracks.stopTrack(); }catch(e){}
        try{ if(typeof metStop==='function') metStop(); }catch(e){}
        try{ if(typeof stopBkTrkAudio==='function') stopBkTrkAudio(); }catch(e){}
        try{ stopPreview(); }catch(e){}
        updateSel();
        return;
      }
      else { window.BackingTracks.startTrack(t); started=true; }
    }catch(e){ console.log('[PACK] play failed:',e&&e.message); }
    // SYNC: when loading (not stopping) a track, start the metronome at the track BPM.
    //   Time signature is left exactly as the user set it (3/4 stays 3/4).
    if(started){
      if(t.ts==='free'){   // v625/626: FREE-pack track -> its sequence + key/BPM + FREE time signature + FREE walk
        try{ if(t.seq) window.__setFreeSeq(t.seq); }catch(e){}
        try{ window.setAppKeyAndTempo(t.key, t.min, t.bpm); }catch(e){}
        try{ window.__armFreePack(); }catch(e){}
      }
      const sb=document.getElementById('hexpackSync');
      if(sb&&sb.checked&&t.bpm){ try{ window.__syncBpmAndStart(t.bpm); }catch(e){} }
    }
    updateSel();
  }
  function buyWithGems(){
    const pack=allPacks()[curPack];
    if(Gems.spend(pack.priceGems)){ unlock(pack.id); try{ flashAurora(_KEYCOL(packKey(pack)),0.7,1800);}catch(e){} try{window.autoSaveBackup('pack-gems:'+pack.id);}catch(e){} updateSel(); }
    else { Gems.openStore(); }
  }
  function buyWithTokens(){
    const pack=allPacks()[curPack];
    if(typeof Tokens==='undefined' || !Tokens.spend) return;
    if(Tokens.spend(pack.priceTokens)){ unlock(pack.id); try{ flashAurora(_KEYCOL(packKey(pack)),0.7,1800);}catch(e){} try{window.autoSaveBackup('pack-tokens:'+pack.id);}catch(e){} updateSel(); }
    else { alert('Not enough tokens. You have '+Tokens.balance+' 🎟, need '+pack.priceTokens+'.'); }
  }

  function render(){
    const host=document.getElementById('hexpackHost'); if(!host) return;
    if(!allPacks().length){
      host.innerHTML='<div style="color:#64748b;font-family:Bangers,cursive;font-size:0.8em;letter-spacing:1px;padding:18px 0;text-align:center;">⏳ Loading track packs…</div>';
      return;
    }
    if(curPack>=allPacks().length) curPack=0;
    const pack=allPacks()[curPack];
    host.innerHTML=
      '<div class="hexpack-stage">'
        +'<div style="display:flex;align-items:center;gap:14px;">'
          +'<button id="hexpackPrev" style="background:#1e293b;color:#fff;border:1px solid #475569;border-radius:50%;width:30px;height:30px;font-size:1em;cursor:pointer;">‹</button>'
          +'<div style="color:#cbd5e1;font-family:Bangers,cursive;font-size:0.78em;letter-spacing:1px;min-width:120px;text-align:center;">'+pack.name+'<br><span style="font-size:0.7em;color:#64748b;">PACK '+(curPack+1)+' / '+allPacks().length+'</span></div>'
          +'<button id="hexpackNext" style="background:#1e293b;color:#fff;border:1px solid #475569;border-radius:50%;width:30px;height:30px;font-size:1em;cursor:pointer;">›</button>'
        +'</div>'
        +'<div class="hexpack-disc-wrap" id="hexpackDiscWrap">'+buildDisc(pack)+'</div>'
        +'<div class="hexpack-dots" id="hexpackDots">'+pack.tracks.map(()=>'<span></span>').join('')+'</div>'
        +'<div class="hexpack-sel"><div class="hexpack-sel-ttl" id="hexpackSelTtl"></div><div class="hexpack-sel-meta" id="hexpackSelMeta"></div></div>'
        +'<div id="hexpackActions" style="display:flex;gap:10px;margin-top:4px;"></div>'
        +'<div style="color:#64748b;font-size:0.62em;font-family:Bangers,cursive;letter-spacing:0.5px;margin-top:2px;">swipe the disc · 6 tracks per pack · no refunds on gems</div>'
      +'</div>';
    sel=0; angle=0;
    selectIndex(0,false);
    wireDisc();
    document.getElementById('hexpackPrev').onclick=()=>{ stopPreview(); curPack=(curPack-1+allPacks().length)%allPacks().length; render(); };
    document.getElementById('hexpackNext').onclick=()=>{ stopPreview(); curPack=(curPack+1)%allPacks().length; render(); };
  }

  // ── swipe / drag rotation with snap-to-nearest-face ──
  function wireDisc(){
    const wrap=document.getElementById('hexpackDiscWrap'); if(!wrap) return;
    let dragging=false, startA=0, startAngle=0, cx=0, cy=0;
    function pointAngle(x,y){ return Math.atan2(y-cy, x-cx)*180/Math.PI; }
    function down(x,y){
      const r=wrap.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2;
      dragging=true; startA=pointAngle(x,y); startAngle=angle;
      const disc=document.getElementById('hexDisc'); if(disc) disc.classList.add('dragging');
    }
    function move(x,y){
      if(!dragging) return;
      angle=startAngle+(pointAngle(x,y)-startA);
      applyAngle(false);
    }
    function up(){
      if(!dragging) return; dragging=false;
      // snap to nearest 60° face; selected index = -angle/STEP rounded
      let idx=Math.round(-angle/STEP);
      selectIndex(idx, true);
    }
    wrap.addEventListener('pointerdown',e=>{ down(e.clientX,e.clientY); wrap.setPointerCapture&&wrap.setPointerCapture(e.pointerId); });
    wrap.addEventListener('pointermove',e=>move(e.clientX,e.clientY));
    wrap.addEventListener('pointerup',up);
    wrap.addEventListener('pointercancel',up);
    // tapping a segment selects it directly
    wrap.querySelectorAll('.hexpack-seg').forEach((s,i)=>{
      s.addEventListener('click',ev=>{ if(!dragging) selectIndex(i,true); });
    });
  }

  return {
    render, isUnlocked, unlock,          // v561: bundles grant pack ownership
    get packs(){ return allPacks(); },
    // DLC hooks — add packs without touching core. addPacks for folder/global injection,
    //   loadFromURL for a remote manifest post-launch, refresh to re-scan window.__TRACK_PACKS.
    addPacks(arr){ mergeExternal(arr); try{render();}catch(e){} },
    loadFromURL,
    refresh(){ ingestGlobal(); try{render();}catch(e){} }
  };
})();
window.TrackPacks=TrackPacks;

// ── SPICE knob — rotary control of EXOTIC_BUDGET (how often the walks reach for exotic
//   scales). 270° sweep, 0–50 (%). Drag to turn (touch + mouse), wheel + arrow keys too.
//   Walkers read window.__spice as a fraction every pick. ──
(function(){
  function clampPct(v){ v=Math.round(v); if(isNaN(v)) v=18; return Math.max(0,Math.min(50,v)); }
  try{ var saved=localStorage.getItem('improvs2_spice'); if(saved!=null) window.__spice=clampPct(parseInt(saved,10))/100; }catch(e){}
  function wire(){
    var knob=document.getElementById('spiceKnob'), ptr=document.getElementById('spicePtr'), out=document.getElementById('spiceVal');
    if(!knob||!ptr) return;
    function render(p){
      ptr.setAttribute('transform','rotate('+(p/50*270-135)+' 21 21)');   // -135°..+135°
      if(out) out.textContent=p+'%';
      knob.setAttribute('aria-valuenow',p);
    }
    function set(p,save){ p=clampPct(p); window.__spice=p/100; render(p);
      if(save){ try{ localStorage.setItem('improvs2_spice', String(p)); }catch(e){} } }
    set((window.__spice!=null)?Math.round(window.__spice*100):18,false);
    var dragging=false;
    function fromEvent(e){
      var r=knob.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
      var t=(e.touches&&e.touches[0])||e, dx=t.clientX-cx, dy=t.clientY-cy;
      var ang=Math.atan2(dx,-dy)*180/Math.PI;          // 0 = up, clockwise positive
      if(ang>135) ang=135; if(ang<-135) ang=-135;
      return clampPct((ang+135)/270*50);
    }
    function down(e){ dragging=true; knob.style.cursor='grabbing'; set(fromEvent(e),true); e.preventDefault(); }
    function move(e){ if(dragging){ set(fromEvent(e),true); e.preventDefault(); } }
    function up(){ if(dragging){ dragging=false; knob.style.cursor='grab'; } }
    knob.addEventListener('pointerdown',down);
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',up);
    knob.addEventListener('wheel',function(e){ set(window.__spice*100+(e.deltaY<0?1:-1),true); e.preventDefault(); },{passive:false});
    knob.addEventListener('keydown',function(e){
      if(e.key==='ArrowUp'||e.key==='ArrowRight'){ set(window.__spice*100+1,true); e.preventDefault(); }
      else if(e.key==='ArrowDown'||e.key==='ArrowLeft'){ set(window.__spice*100-1,true); e.preventDefault(); }
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();

// Instant Buy — real-money purchase shortcut (IAP). Stubbed until store billing is wired;
// on success it unlocks the item immediately, no tokens spent.
// In-app purchase confirm — a real DOM dialog. Native confirm() is blocked in many
//   webviews (incl. the Claude in-app viewer) and unreliable under Capacitor, so we render our own.
function showBuyConfirm(label, price, onYes){
  const old=document.getElementById('buyConfirmOv'); if(old) old.remove();
  const ov=document.createElement('div'); ov.id='buyConfirmOv';
  ov.style.cssText='position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:24px;';
  ov.innerHTML=
    '<div style="max-width:340px;width:100%;background:#12121a;border:1px solid #3b3b52;border-radius:14px;padding:20px;box-shadow:0 12px 40px #000b;font-family:Bangers,cursive;text-align:center;">'
    +'<div style="font-size:1.35em;letter-spacing:1px;color:#fff;margin-bottom:4px;">'+(label||'Purchase')+'</div>'
    +'<div style="font-size:2em;color:#ffd700;letter-spacing:1px;margin:2px 0 6px;">'+(price||'$0.99')+'</div>'
    +'<div style="font-family:-apple-system,system-ui,sans-serif;font-size:0.72em;color:#9aa;margin-bottom:16px;">One-time purchase</div>'
    +'<div style="display:flex;gap:10px;">'
      +'<button id="buyConfirmNo" style="flex:1;padding:11px;border-radius:9px;border:1px solid #444;background:#1e1e28;color:#ccc;font-family:Bangers,cursive;font-size:0.95em;letter-spacing:1px;cursor:pointer;">Cancel</button>'
      +'<button id="buyConfirmYes" style="flex:1.4;padding:11px;border-radius:9px;border:1px solid #22c55e;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;font-family:Bangers,cursive;font-size:0.95em;letter-spacing:1px;cursor:pointer;">Buy</button>'
    +'</div></div>';
  document.body.appendChild(ov);
  const close=()=>ov.remove();
  ov.querySelector('#buyConfirmNo').onclick=close;
  ov.addEventListener('click',e=>{ if(e.target===ov) close(); });
  ov.querySelector('#buyConfirmYes').onclick=()=>{ close(); try{ onYes&&onYes(); }catch(e){} };
}
function instantBuy(itemId, price, label, onUnlock){
  showBuyConfirm(label||itemId, price||'$0.99', function(){
    let done=false;
    try{ if(typeof AdManager!=='undefined' && AdManager.purchase){ done=AdManager.purchase(itemId); } }catch(e){}
    // billing not wired yet → treat confirm as success so the flow is testable end-to-end
    if(onUnlock) onUnlock();
    console.log('[BUY] instant-buy '+itemId+' ('+(price||'$0.99')+') billing='+done);
  });
}

// AURORA flare — fades a northern-lights wash over the whole app, then fades out (display:none at rest)
let _aurT=null,_aurT2=null;
function flashAurora(colour, peak, ms){
  const a=document.getElementById('aurora'); if(!a) return;
  a.style.setProperty('--aur', colour);
  a.style.display='block'; void a.offsetWidth;
  a.style.opacity=String(peak);
  clearTimeout(_aurT); clearTimeout(_aurT2);
  _aurT=setTimeout(()=>{ a.style.opacity='0';
    _aurT2=setTimeout(()=>{ if(a.style.opacity==='0') a.style.display='none'; }, 1100); }, ms);
}

// ── LOOT CHESTS — tiered reward chests earned from aura levels. Opening one rolls a loot
//    table and dispenses aura, tokens, rare tokens, direct unlocks, even more chests. ──
const Loot = (function(){
  const TIERS={
    common:   {name:'COMMON',    colour:'#22c55e', glow:'#22c55e'},
    rare:     {name:'RARE',      colour:'#3b82f6', glow:'#3b82f6'},
    epic:     {name:'EPIC',      colour:'#a855f7', glow:'#c084fc'},
    legendary:{name:'LEGENDARY', colour:'#f59e0b', glow:'#fbbf24'}
  };
  const CYCLE=['common','rare','epic','legendary'];   // chest tier every 3rd level, in order
  // readable text colour on a solid tier background (dark on gold, white on the rest)
  function tierText(hex){ const h=(hex||'').replace('#',''); if(h.length<6) return '#fff';
    const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    return (0.299*r+0.587*g+0.114*b)>150 ? '#15131c' : '#ffffff'; }
  let inv={common:0,rare:0,epic:0,legendary:0}, rareTok=0;
  try{ const d=JSON.parse(localStorage.getItem('improvs2_loot')||'{}');
    inv=Object.assign(inv,d.inv||{}); rareTok=d.rareTok||0; }catch(e){}
  function save(){ try{ localStorage.setItem('improvs2_loot',JSON.stringify({inv,rareTok})); }catch(e){} }
  const totalChests=()=>inv.common+inv.rare+inv.epic+inv.legendary;
  const rarest=()=>['legendary','epic','rare','common'].find(t=>inv[t]>0)||null;

  // grant a chest on every 3rd level (tier cycles common→rare→epic→legendary)
  function onLevelUp(level){
    // chest every 3rd level (existing)
    if(level%3===0){ const tier=CYCLE[((level/3-1)%4+4)%4]; inv[tier]++; save();
      console.log('[LOOT] level '+level+' → '+tier+' chest earned'); }
    // every 6th level → 1 free single track from any pack
    if(level%6===0){
      try{
        const result=grantUnlock('track');
        // show a toast so the player knows they got a free track
        const msg='🎵 Level '+level+' reward: '+result.label;
        try{
          const t=document.createElement('div');
          t.style.cssText='position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1400;border:2px solid #ffd700;border-radius:10px;padding:11px 18px;font-family:Bangers,cursive;font-size:0.9em;letter-spacing:1px;color:#ffd700;text-align:center;box-shadow:0 4px 18px #000a;max-width:90vw;pointer-events:none;';
          t.textContent=msg;
          document.body.appendChild(t);
          setTimeout(()=>t.remove(),4500);
        }catch(e){}
        console.log('[LOOT]',msg);
      }catch(e){}
    }
    render();
  }

  // find a random locked item of a kind and unlock it; if none locked, fall back to a token
  function grantUnlock(kind){
    try{
      if(kind==='track' && typeof window.grantRandomTrackUnlock==='function'){
        const nm=window.grantRandomTrackUnlock();
        if(nm) return {icon:'🎵',label:'Track unlocked: '+nm};
      }
      // sample-pack store catalog not populated yet → falls back to a token below
    }catch(e){}
    Tokens.add(1);
    return {icon:'🎟',label:(kind==='sample'?'Sample unlock':'Track unlock')+' → +1 token (none locked yet)'};
  }

  // roll a tier's loot table → array of {icon,label} rewards, applying each
  function rollLoot(tier){
    const out=[];
    const aura=n=>{ Aura.awardRaw(n); out.push({icon:'✨',label:'+'+n+' aura'}); };
    if(tier==='common'){ aura(3); }
    else if(tier==='rare'){
      rareTok++; save(); out.push({icon:'🔷',label:'+1 rare token (= 1 backing track)'});
      aura(2);
      if(Math.random()<0.30) out.push(grantUnlock('track'));
    }
    else if(tier==='epic'){
      out.push(grantUnlock('sample'));
      aura(3);
    }
    else if(tier==='legendary'){
      aura(4);
      out.push(grantUnlock(Math.random()<0.5?'sample':'track'));
      Tokens.add(1); out.push({icon:'🎟',label:'+1 unlock token'});
      const bonusTier=CYCLE[Math.floor(Math.random()*3)];   // a fresh chest (common–epic)
      inv[bonusTier]++; save();
      out.push({icon:'🎁',label:'+1 '+TIERS[bonusTier].name+' chest'});
    }
    return out;
  }

  // ROLL FOR LOOT — when the player has no chests, let them earn one by watching a
  //   rewarded ad. Rolls a weighted random rarity (commons frequent, legendaries rare),
  //   grants that chest, then opens it immediately so the reward reveal plays.
  function rollForLoot(){
    // v461: the roll is GRANTED BY the rewarded ad (native: didRewardUser → AdManager.rewardGranted).
    const doRoll=()=>{
      // weighted roll: common 55% · rare 28% · epic 13% · legendary 4%
      const r=Math.random(); const tier = r<0.55?'common' : r<0.83?'rare' : r<0.96?'epic' : 'legendary';
      inv[tier]++; save();
      console.log('[LOOT] roll-for-loot → '+tier+' chest');
      openOne(tier); render();
    };
    AdEngine.rewarded('roll-for-loot', {
      onReward: doRoll,
      // no fill / not loaded: never dead-end the button — pity common so the tap always pays off
      onUnavailable: ()=>{ console.log('[LOOT] rewarded unavailable — pity common'); inv.common++; save(); openOne('common'); render(); }
    });
  }
  // v474: entry point for the rewarded BONUS ROLL button (wired in another scope)
  window.__lootBonusRoll=function(){
    const r=Math.random(); const tier = r<0.55?'common' : r<0.83?'rare' : r<0.96?'epic' : 'legendary';
    inv[tier]++; save();
    console.log('[LOOT] bonus roll \u2192 '+tier+' chest');
    openOne(tier); render();
  };

  function openOne(tier){
    if(!inv[tier]) return;
    inv[tier]--; save();
    // v461: no ad at open — the interstitial fires after COLLECT (natural break, dead-zoned)
    let loot=[];
    try{ loot=rollLoot(tier); }catch(e){ console.log('[LOOT] rollLoot error:',e.message); }
    if(!loot || !loot.length){ try{ Aura.awardRaw(3); }catch(_){} loot=[{icon:'✨',label:'+3 aura'}]; }  // never empty
    showReveal(tier, loot);
    render();
    console.log('[LOOT] opened '+tier+' →', loot.map(l=>l.label).join(', '));
  }

  // synthesized reward chime (no audio files needed) — grander arpeggio for higher tiers
  function playRewardSound(tier){
    try{
      if(window.ensureAudio) window.ensureAudio();
      const ac=window.getAC?window.getAC():null; if(!ac) return;
      const now=ac.currentTime+0.02;
      const NOTES={common:[523,659,784], rare:[523,659,784,1047], epic:[523,659,784,1047,1319], legendary:[392,523,659,784,1047,1568]};
      const ns=NOTES[tier]||[523,659,784];
      ns.forEach((f,i)=>{ const o=ac.createOscillator(),g=ac.createGain();
        o.type=(tier==='legendary'||tier==='epic')?'triangle':'sine'; o.frequency.value=f;
        const t=now+i*0.075; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.16,t+0.015);
        g.gain.exponentialRampToValueAtTime(0.0008,t+0.45);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t+0.5); });
    }catch(e){}
  }
  function playTension(tier){
    try{ const ac=window.getAC?window.getAC():null; if(!ac) return;
      const now=ac.currentTime, dur=(tier==='legendary'?1.4:tier==='epic'?1.1:0.9);
      const o=ac.createOscillator(),g=ac.createGain(); o.type='sawtooth';
      o.frequency.setValueAtTime(110,now); o.frequency.exponentialRampToValueAtTime(420,now+dur);
      g.gain.setValueAtTime(0.0008,now); g.gain.linearRampToValueAtTime(0.05,now+dur*0.8); g.gain.exponentialRampToValueAtTime(0.0008,now+dur);
      o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now+dur+0.05);
    }catch(e){}
  }
  const CONFETTI={common:['#22c55e','#86efac','#ffffff','#ffe14d'], rare:['#3b82f6','#93c5fd','#ffffff','#ffe14d'],
    epic:['#a855f7','#d8b4fe','#f0abfc','#ffffff','#3ba9ff'], legendary:['#f59e0b','#fbbf24','#fde68a','#fff','#ff8844','#37d67a','#3ba9ff','#c061ff']};
  const PICK_COLS=['#ff3b3b','#ff9f1c','#ffe14d','#37d67a','#3ba9ff','#c061ff','#ffffff'];
  // a burst of mixed debris: guitar picks (pick shape), coins (gold discs), gems (diamonds) + confetti rects
  function spawnConfetti(tier, big){
    const m=document.getElementById('chestModal'); if(!m) return;
    const cols=CONFETTI[tier]||CONFETTI.common;
    const base=tier==='legendary'?64:tier==='epic'?48:tier==='rare'?36:26;
    const n=big?base:Math.round(base*0.28);
    for(let i=0;i<n;i++){
      const c=document.createElement('div'); c.className='confetti';
      const r=Math.random(), kind = r<0.42?'pick' : r<0.62?'coin' : r<0.78?'gem' : 'rect';
      c.style.left=(44+Math.random()*12)+'%'; c.style.top='42%';
      const ang=Math.random()*Math.PI*2, dist=(big?90:50)+Math.random()*(big?230:120);
      c.style.setProperty('--dx',(Math.cos(ang)*dist)+'px');
      c.style.setProperty('--dy',(Math.sin(ang)*dist-(big?90:50))+'px');
      c.style.setProperty('--dr',(Math.random()*900-450)+'deg');
      if(kind==='pick'){ const col=PICK_COLS[i%PICK_COLS.length];
        c.innerHTML='<svg width="15" height="17" viewBox="0 0 60 68"><path d="M8 18 Q30 2 52 18 Q56 42 30 64 Q4 42 8 18 Z" fill="'+col+'"/></svg>'; }
      else if(kind==='coin'){ c.style.width='15px'; c.style.height='15px'; c.style.borderRadius='50%';
        c.style.background='radial-gradient(circle at 38% 34%,#fff3b0,#f5b400 60%,#b8860b)'; c.style.boxShadow='0 0 4px #ffcf3388'; }
      else if(kind==='gem'){ const gc=cols[i%cols.length];
        c.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 3 H19 L23 9 L12 22 L1 9 Z" fill="'+gc+'" stroke="#fff8" stroke-width="0.8"/></svg>'; }
      else { c.style.width=(5+Math.random()*7)+'px'; c.style.height=(8+Math.random()*9)+'px';
        c.style.background=cols[i%cols.length]; c.style.borderRadius='2px'; }
      c.style.animation='confettiFly '+((big?1.0:0.7)+Math.random()*0.7)+'s ease-out forwards';
      m.appendChild(c); setTimeout(()=>c.remove(),1900);
    }
  }
  // small thwack sound for each smash hit
  function playThwack(){
    try{ const ac=window.getAC?window.getAC():null; if(!ac) return;
      const now=ac.currentTime;
      const o=ac.createOscillator(),g=ac.createGain(); o.type='square';
      o.frequency.setValueAtTime(180,now); o.frequency.exponentialRampToValueAtTime(60,now+0.12);
      g.gain.setValueAtTime(0.18,now); g.gain.exponentialRampToValueAtTime(0.001,now+0.14);
      o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now+0.16);
      // noise burst for the "crack"
      const bs=ac.createBufferSource(), buf=ac.createBuffer(1,ac.sampleRate*0.08,ac.sampleRate), d=buf.getChannelData(0);
      for(let k=0;k<d.length;k++) d[k]=(Math.random()*2-1)*Math.pow(1-k/d.length,2);
      bs.buffer=buf; const ng=ac.createGain(); ng.gain.value=0.12; bs.connect(ng); ng.connect(ac.destination); bs.start(now);
    }catch(e){}
  }

  function showReveal(tier, loot){
    const m=document.getElementById('chestModal'); if(!m) return;
    const T=TIERS[tier];
    document.getElementById('chestModalTier').textContent=T.name+' PIÑATA';
    document.getElementById('chestModalTier').style.color=T.colour;
    document.getElementById('chestModalCard').style.borderColor=T.colour;
    document.getElementById('chestModalCard').style.boxShadow='0 0 44px '+T.glow+'66';
    const chest=document.getElementById('chestModalChest');
    const host=document.getElementById('chestModalLoot'); host.innerHTML='';
    const btn=document.getElementById('chestModalBtn'); if(btn) btn.style.visibility='hidden';
    const bb=document.getElementById('chestBonusBtn'); if(bb){ bb.style.visibility='hidden'; bb.style.display='none'; }
    // ── PIÑATA v460: real dreadnought silhouette, papel-picado fringe, tassels, wood neck ──
    const BODY='M60 14 C72 14 80 21 81 32 C82 41 79 49 74 56 C85 63 92 76 92 92 C92 114 78 128 60 128 C42 128 28 114 28 92 C28 76 35 63 46 56 C41 49 38 41 39 32 C40 21 48 14 60 14 Z';
    const PAL=[T.glow,'#ffffff',T.colour,'#ffd54a'];
    let fringe='';
    for(let r=0;r<8;r++){
      const fy=16+r*14, col=PAL[r%PAL.length];
      let row='<rect x="20" y="'+fy+'" width="80" height="14" fill="'+col+'"/>';
      for(let cx=24;cx<=96;cx+=8) row+='<circle cx="'+cx+'" cy="'+(fy+14)+'" r="4.6" fill="'+col+'"/>';
      fringe+='<g>'+row+'</g><line x1="22" y1="'+fy+'" x2="98" y2="'+fy+'" stroke="#00000022" stroke-width="1"/>';
    }
    let tassels='';
    [38,49,60,71,82].forEach((tx,i)=>{ tassels+='<path d="M'+tx+' '+(122+((i%2)?2:5))+' q3 8 -2 14 q-4 7 1 13" fill="none" stroke="'+PAL[i%PAL.length]+'" stroke-width="3.4" stroke-linecap="round"/>'; });
    let gstr='';
    for(let s=0;s<6;s++){ gstr+='<line x1="'+(56+s*1.6)+'" y1="-20" x2="'+(52+s*3.2)+'" y2="62" stroke="#ffffff3d" stroke-width="0.9"/>'; }
    chest.innerHTML='<svg viewBox="-10 -66 140 226" width="150" height="242" style="overflow:visible;">'
      +'<defs>'
        +'<clipPath id="pbody"><path d="'+BODY+'"/></clipPath>'
        +'<linearGradient id="pneck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5631"/><stop offset="1" stop-color="#33200f"/></linearGradient>'
        +'<radialGradient id="pshine" cx="0.32" cy="0.24" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="#000000" stop-opacity="0.28"/></radialGradient>'
      +'</defs>'
      +'<path d="M60 -66 C57 -56 63 -50 60 -40" fill="none" stroke="#cdb489" stroke-width="2.4" stroke-linecap="round"/>'
      +'<circle cx="60" cy="-39" r="2.6" fill="#cdb489"/>'
      +'<rect x="52" y="-40" width="16" height="17" rx="3" fill="url(#pneck)" stroke="#170e06" stroke-width="1.4"/>'
      +'<circle cx="49" cy="-35" r="2.1" fill="#e8d9a8"/><circle cx="49" cy="-29" r="2.1" fill="#e8d9a8"/><circle cx="49" cy="-23.5" r="2.1" fill="#e8d9a8"/>'
      +'<circle cx="71" cy="-35" r="2.1" fill="#e8d9a8"/><circle cx="71" cy="-29" r="2.1" fill="#e8d9a8"/><circle cx="71" cy="-23.5" r="2.1" fill="#e8d9a8"/>'
      +'<path d="M55 -23 L65 -23 L64 18 L56 18 Z" fill="url(#pneck)" stroke="#170e06" stroke-width="1.4"/>'
      +'<rect x="54.4" y="-23.5" width="11.2" height="2.4" fill="#efe6c8"/>'
      +'<line x1="55.6" y1="-13" x2="64.4" y2="-13" stroke="#d9c089" stroke-width="1"/>'
      +'<line x1="55.8" y1="-3" x2="64.2" y2="-3" stroke="#d9c089" stroke-width="1"/>'
      +'<line x1="56" y1="7" x2="64" y2="7" stroke="#d9c089" stroke-width="1"/>'
      +tassels
      +'<path d="'+BODY+'" fill="'+T.colour+'"/>'
      +'<g clip-path="url(#pbody)">'+fringe
        +'<path d="'+BODY+'" fill="url(#pshine)"/>'
      +'</g>'
      +gstr
      +'<circle cx="60" cy="76" r="15" fill="none" stroke="#1a1320" stroke-width="2.4"/>'
      +'<circle cx="60" cy="76" r="11.5" fill="#120d18"/>'
      +'<circle cx="60" cy="76" r="13.4" fill="none" stroke="'+T.glow+'" stroke-width="1.4" stroke-dasharray="2.6 2.2"/>'
      +'<rect x="47" y="97" width="26" height="6.5" rx="2.4" fill="#1a1320"/>'
      +'<rect x="49" y="98.6" width="22" height="1.6" rx="0.8" fill="#e8d9a8"/>'
      +'<path d="'+BODY+'" fill="none" stroke="#1a1320" stroke-width="3"/>'
      +'</svg>';
    chest.style.filter='drop-shadow(0 0 14px '+T.glow+')';
    chest.style.cursor='pointer';
    chest.style.visibility='visible';
    m.style.display='flex';

    // hint line under the piñata
    let hint=document.getElementById('smashHint');
    if(!hint){ hint=document.createElement('div'); hint.id='smashHint'; hint.className='smash-hint';
      hint.style.cssText+='margin-top:6px;font-size:1.05em;text-align:center;'; chest.parentNode.insertBefore(hint, chest.nextSibling); }
    hint.className='smash-hint'; hint.style.display='block';

    let hits=0; const NEED=3; let busy=false; let done=false;
    chest.classList.remove('pinata-burst'); chest.classList.add('pinata-sway');
    hint.textContent='SMASH IT!  (0/'+NEED+')';
    try{ playTension(tier); }catch(e){}

    function smash(){
      if(done||busy) return;
      busy=true; hits++;
      chest.classList.remove('pinata-sway'); chest.classList.remove('pinata-hit'); void chest.offsetWidth;
      // audio & haptics can throw in sandboxed webviews — they must never eat a hit or wedge `busy`
      try{ playThwack(); }catch(e){}
      try{ haptic([0,40,30][Math.min(hits-1,2)]||40); }catch(e){}
      if(hits<NEED){
        chest.classList.add('pinata-hit');
        hint.textContent='SMASH IT!  ('+hits+'/'+NEED+')';
        setTimeout(()=>{ chest.classList.remove('pinata-hit'); chest.classList.add('pinata-sway'); busy=false; }, 480);
        try{ spawnConfetti(tier,false); }catch(e){}   // small spray of debris per hit
      } else {
        // 3rd smash → BURST
        done=true; hint.style.display='none';
        chest.classList.add('pinata-burst');
        try{ playRewardSound(tier); }catch(e){}
        try{ spawnConfetti(tier,true); setTimeout(()=>spawnConfetti(tier,true),120); setTimeout(()=>spawnConfetti(tier,true),260); }catch(e){}
        const AUR={common:[0.5,1600],rare:[0.62,2000],epic:[0.72,2400],legendary:[0.85,2900]};
        const ap=AUR[tier]||AUR.common; try{ flashAurora(T.glow, ap[0], ap[1]); }catch(e){}
        // cascade rewards in after the burst
        setTimeout(()=>{ chest.style.visibility='hidden'; }, 520);
        loot.forEach((l,idx)=>setTimeout(()=>{
          const d=document.createElement('div'); d.className='loot-reward'; d.style.opacity='1';
          d.innerHTML='<span style="font-size:1.2em;">'+(l.icon||'✨')+'</span> '+(l.label||'reward'); host.appendChild(d);
        }, 420+idx*240));
        setTimeout(()=>{ if(btn) btn.style.visibility='visible'; try{ window.__refreshBonusBtn && window.__refreshBonusBtn(); }catch(e){} }, 420+loot.length*240);
      }
    }
    // pointerdown = instant response (no click delay); busy/done guards absorb ghost clicks
    chest.onpointerdown=function(e){ e.preventDefault(); smash(); };
    chest.onclick=null;
  }

  // ── LOOT PYRAMID — 1 legendary / 2 epic / 3 rare / 4 common; glowing block = a chest you own ──
  function renderPyramid(){
    const host=document.getElementById('pyramidRows'); if(!host) return;
    host.innerHTML='';
    [['legendary',1],['epic',2],['rare',3],['common',4]].forEach(([t,n])=>{
      const T=TIERS[t], owned=inv[t];
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:9px;align-items:center;';
      for(let i=0;i<n;i++){ const lit=i<owned;
        const b=document.createElement('div'); b.className='pyr-block'+(lit?' lit':'');
        b.style.background= lit ? 'linear-gradient(160deg,'+T.colour+','+T.colour+'aa)' : '#15131c';
        b.style.border= lit ? '2px solid '+T.glow : '2px dashed '+T.colour+'4d';
        b.style.boxShadow= lit ? '0 0 14px '+T.glow+'cc' : 'none';
        b.style.opacity= lit ? '1' : '.45';
        b.textContent= lit ? '🎸' : '';
        if(lit){ b.title='Open a '+T.name+' chest'; b.addEventListener('click',()=>{ openOne(t); setTimeout(renderPyramid,60); }); }
        row.appendChild(b);
      }
      if(owned>n){ const x=document.createElement('div'); x.style.cssText='color:'+T.colour+';font-weight:900;font-size:0.78em;'; x.textContent='+'+(owned-n); row.appendChild(x); }
      host.appendChild(row);
    });
  }
  function openPyramid(){ renderPyramid(); const p=document.getElementById('lootPyramid'); if(p) p.style.display='flex'; }

  function render(){
    const bar=document.getElementById('chestBar'), invEl=document.getElementById('chestInv'),
          btn=document.getElementById('openChestBtn'), lbl=document.getElementById('openChestLbl'),
          rc=document.getElementById('rareChip'), rcN=document.getElementById('rareCount');
    if(rc){ rc.style.display=rareTok>0?'flex':'none'; if(rcN) rcN.textContent=rareTok; }
    const py=document.getElementById('lootPyramid'); if(py && py.style.display==='flex') renderPyramid();
    if(!bar) return;
    const any=totalChests()>0;
    const roll=document.getElementById('rollLootBtn');
    // bar is visible when the player has chests to open OR can roll for one
    bar.style.display='flex';
    if(roll) roll.style.display=any?'none':'inline-flex';
    if(invEl){ invEl.innerHTML='';
      ['common','rare','epic','legendary'].forEach(t=>{ if(inv[t]>0){ const T=TIERS[t];
        const b=document.createElement('span'); b.className='chest-badge';
        b.style.background='linear-gradient(135deg,'+T.colour+','+T.colour+'cc)'; b.style.border='1px solid '+T.glow; b.style.color=tierText(T.colour); b.style.boxShadow='0 0 8px '+T.glow+'66';
        b.innerHTML='🎸 '+T.name.toUpperCase()+' ×'+inv[t]; b.title='Open a '+T.name+' chest';
        b.addEventListener('click',()=>openOne(t)); invEl.appendChild(b); } }); }
    if(btn){ const r=rarest();
      if(r){ btn.style.display='inline-flex'; const T=TIERS[r];
        btn.style.background='linear-gradient(135deg,'+T.colour+','+T.colour+'cc)';
        btn.style.boxShadow='0 0 14px '+T.glow+'aa';
        if(lbl) lbl.textContent='OPEN ×'+totalChests(); }
      else btn.style.display='none'; }
  }

  // v815: grant(tier, n) — real inventory write for jam/versus winners etc.
  function grant(tier, n){
    const t=String(tier||'').toLowerCase();
    const k=['common','rare','epic','legendary'].indexOf(t)>=0?t:'common';
    const add=Math.max(1, n|0);
    inv[k]=(inv[k]|0)+add;
    save();
    try{ render(); }catch(e){}
    console.log('[LOOT] grant → '+k+' ×'+add+' (now '+inv[k]+')');
    return {tier:k, count:inv[k]};
  }
  return { onLevelUp, render, openPyramid, renderPyramid, rollForLoot, openRarest(){ const r=rarest(); if(r) openOne(r); },
           grantRandom(){ // build 537: award ONE weighted-random chest and reveal it (used for S-grade reward)
             const r=Math.random(); const tier = r<0.55?'common' : r<0.83?'rare' : r<0.96?'epic' : 'legendary';
             inv[tier]++; save(); console.log('[LOOT] S-grade reward → '+tier+' chest'); openOne(tier); render(); return tier; },
           grant, openOne,
           get inventory(){ return {common:inv.common|0, rare:inv.rare|0, epic:inv.epic|0, legendary:inv.legendary|0}; },
           get rareTokens(){return rareTok;}, spendRare(n){ if(rareTok<n) return false; rareTok-=n; save(); render(); return true; } };
})();
window.Loot=Loot;

const Aura = (function(){
  const PALETTE = ['#EDF0CF','#9AE66A','#00CC66','#78E1B7','#78D4EF','#558BE1','#1B1B1C','#AE78C6','#DD6EBB','#F0483A','#FF8844','#FFDD00'];
  const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const STEP = 12;
  let total=0, pending=0, lastLevel=-1;
  try{ const d=JSON.parse(localStorage.getItem('improvs2_aura')||'{}'); total=d.total||0; pending=d.pending||0; }catch(e){}
  function save(){ try{ localStorage.setItem('improvs2_aura',JSON.stringify({total,pending})); }catch(e){} }
  function render(){
    const inCycle=total%STEP;
    const orb=document.getElementById('auraOrb'),fill=document.getElementById('auraFill'),cnt=document.getElementById('auraCount'),claim=document.getElementById('auraClaim'),lbl=document.getElementById('auraLevelLbl');
    if(!orb) return;
    const level=Math.floor(total/STEP);
    const colour=PALETTE[level%PALETTE.length];
    const txt=(0.299*parseInt(colour.substr(1,2),16)+0.587*parseInt(colour.substr(3,2),16)+0.114*parseInt(colour.substr(5,2),16))>140?'#000':'#fff';
    orb.style.background=colour; orb.style.boxShadow='0 0 12px '+colour+',inset 0 0 6px #fff8';
    fill.style.background=colour; fill.style.width=((inCycle/STEP)*100)+'%'; fill.style.boxShadow=inCycle>0?'inset -3px 0 0 rgba(255,255,255,0.9)':'none';
    if(cnt){cnt.textContent=inCycle+' / '+STEP; cnt.style.color='#fff'; cnt.style.textShadow='0 1px 3px #0009';}
    if(lbl){ lbl.textContent='Level '+(level+1)+' · '+NOTE[level%12];
      lbl.style.color=txt;
      lbl.style.background=colour;  // badge = current note colour
      lbl.style.padding='2px 7px'; lbl.style.borderRadius='4px';
      lbl.style.textShadow='none'; lbl.style.boxShadow='0 0 8px '+colour+'99'; }
    var aw=document.getElementById('auraWord'); if(aw){ aw.style.color='#fff'; aw.style.textShadow='0 0 6px '+colour+', 0 0 2px '+colour; aw.style.fontFamily="'Bangers',cursive"; aw.style.letterSpacing='0.1em'; aw.style.fontSize='1.1em'; }
    const claimBtn=document.getElementById('auraClaim'); if(claimBtn) claimBtn.style.display='none';  // chests replace per-level claim
    // level-up celebration: pop the label, sweep a shine across the bar
    if(lastLevel>=0 && level>lastLevel){
      if(lbl){ lbl.classList.remove('aura-level-pop'); void lbl.offsetWidth; lbl.classList.add('aura-level-pop'); }
      const sh=document.getElementById('auraShine'); if(sh){ sh.classList.remove('aura-shine-go'); void sh.offsetWidth; sh.classList.add('aura-shine-go'); }
    }
    lastLevel=level;
  }
  // add aura, crossing levels → each level grants a chest (via Loot) and, if withBonus, +3 aura
  function addAura(points, withBonus){
    let lvl=Math.floor(total/STEP);
    total+=points;
    let nl=Math.floor(total/STEP);
    while(nl>lvl){ lvl++;
      if(withBonus){ total+=3; }                 // level-up bonus aura
      try{ Loot.onLevelUp(lvl); }catch(e){}      // chest every 3rd level
      nl=Math.floor(total/STEP);
    }
    save(); render();
  }
  function award(points,reason){
    if(points<=0){ render(); return; }
    addAura(points*2, true);                     // graded aura doubled + level bonuses
    try{ flashAurora('#22c55e', 0.5, 1500); }catch(e){}   // green northern-lights flare
    console.log('[AURA] +'+(points*2)+' ('+reason+') total='+total+' level='+Math.floor(total/STEP));
  }
  function awardRaw(points){ if(points>0) addAura(points, false); }   // chest loot aura (no double, no bonus)
  function claim(){ try{ Loot.openRarest(); }catch(e){} return true; } // legacy hook → opens a chest
  function spend(n){ if(total<n) return false; total-=n; save(); render(); return true; }
  return { award, awardRaw, claim, render, spend, get total(){return total;}, get pending(){return pending;} };
})();
document.addEventListener('DOMContentLoaded',()=>{
  const openBtn=document.getElementById('openChestBtn');
  if(openBtn) openBtn.addEventListener('click',()=>Loot.openPyramid());
  const rollBtn=document.getElementById('rollLootBtn');
  if(rollBtn) rollBtn.addEventListener('click',()=>Loot.rollForLoot());
  const gemChip=document.getElementById('gemChip');
  if(gemChip) gemChip.addEventListener('click',()=>Gems.openStore());
  const pc=document.getElementById('pyramidClose'), pyr=document.getElementById('lootPyramid');
  if(pc) pc.addEventListener('click',()=>{ if(pyr) pyr.style.display='none'; });
  if(pyr) pyr.addEventListener('click',e=>{ if(e.target===pyr) pyr.style.display='none'; });
  const mBtn=document.getElementById('chestModalBtn'), modal=document.getElementById('chestModal');
  let skipCollectAd=false;   // a rewarded BONUS ROLL replaces that cycle's collect interstitial — never both
  const bBtn=document.getElementById('chestBonusBtn');
  window.__refreshBonusBtn=function(){
    if(!bBtn) return;
    let left=0; try{ left=AdEngine.bonusRollsLeft(); }catch(e){}
    if(left>0){ bBtn.style.display='inline-block'; bBtn.style.visibility='visible'; bBtn.textContent='\ud83c\udfac BONUS ROLL \u00b7 '+left; }
    else bBtn.style.display='none';
  };
  if(bBtn) bBtn.addEventListener('click',()=>{
    try{
      AdEngine.rewarded('bonus-roll',{
        onReward:()=>{
          try{ AdEngine.bump('bonusroll_redeem'); }catch(e){}
          skipCollectAd=true;
          if(modal) modal.style.display='none';
          try{ window.__lootBonusRoll && window.__lootBonusRoll(); }catch(e){}
        }
      });
    }catch(e){}
  });
  if(mBtn) mBtn.addEventListener('click',()=>{ if(modal) modal.style.display='none'; if(skipCollectAd){ skipCollectAd=false; } else { try{ AdEngine.interstitial('collect'); }catch(e){} } });
  if(modal) modal.addEventListener('click',e=>{ if(e.target===modal){ modal.style.display='none'; if(skipCollectAd){ skipCollectAd=false; } else { try{ AdEngine.interstitial('collect'); }catch(e){} } } });
  Aura.render(); Tokens.render(); Gems.render(); Loot.render();
});

// ─── JUDGE WEIGHTS — each source has an adjustable vote weight (0.25–2.5, step 0.25) ──
//     The master grade = weighted average of base Scoring + 5 judge scores.
const JudgeWeights = (function(){
  const KEY='improvs2_jw';
  const DEF={ scoring:1.0, artie:1.0, billie:1.0, howie:1.0, freddie:1.0, jackie:1.0 };
  // Presets lean on each judge's built-in curve bias: artie(+12)/jackie(0,generous mid-lo)/billie(0)
  // are lenient-leaning; howie(-14)/freddie(-4) are strict. Easy amplifies the lenient voices and
  // mutes the strict ones; Hard does the reverse. Medium = neutral (all equal).
  const PRESETS={
    easy:  { scoring:0.50, artie:2.50, billie:2.50, howie:0.25, freddie:0.25, jackie:0.50 },
    medium:{ scoring:1.25, artie:2.25, billie:2.25, howie:0.25, freddie:0.25, jackie:1.25 },
    hard:  { scoring:1.00, artie:2.50, billie:2.25, howie:0.50, freddie:1.25, jackie:1.50 }
  };
  function load(){ try{
      var raw=localStorage.getItem(KEY);
      if(raw==null){ var m=Object.assign({},PRESETS.hard); localStorage.setItem(KEY,JSON.stringify(m)); return m; }   // v708: default = HARD (most honest)
      return Object.assign({},DEF,JSON.parse(raw));
    }catch(e){ return Object.assign({},PRESETS.hard); } }
  function save(w){ try{ localStorage.setItem(KEY,JSON.stringify(w)); }catch(e){} }
  function get(id){ return load()[id]??1.0; }
  function adjust(id,d){ const w=load(); w[id]=Math.max(0.25,Math.min(2.5,Math.round(((w[id]??1.0)+d)*100)/100)); save(w); return w[id]; }
  function letter(s){ return s>=95?'S':s>=88?'A+':s>=78?'A':s>=65?'B':s>=50?'C':'F'; }
  function auraVal(g){ return g==='S'?5:g==='A+'?4:g==='A'?3:g==='B'?2:g==='C'?1:0; }
  function blend(raw){
    const w=load(); let s=0,ws=0;
    for(const id in raw){ const wi=w[id]??1; s+=raw[id]*wi; ws+=wi; }
    if(!ws) return { score:0, grade:'F', aura:0 };
    const sc=Math.round(s/ws); const g=letter(sc); return { score:sc, grade:g, aura:auraVal(g) };
  }
  function all(){ return load(); }
  function setPreset(name){ const p=PRESETS[name]; if(!p) return null; save(Object.assign({},p)); return p; }
  function currentPreset(){
    const w=load();
    for(const name in PRESETS){ if(Object.keys(PRESETS[name]).every(k=>w[k]===PRESETS[name][k])) return name; }
    return 'custom';
  }
  return { get, adjust, blend, all, letter, auraVal, setPreset, currentPreset, PRESETS };
})();
window.JudgeWeights = JudgeWeights;

function gradePerformance(metrics,reason){
  const r=Scoring.gradeFrom(metrics);
  try{ r.judges=Judges.verdicts(metrics); }catch(e){}
  try{ r.argument=Judges.argument(); }catch(e){}
  // Store raw scores for weighted blend
  r._raw={ scoring:r.score };
  if(r.judges) r.judges.forEach(function(j){ r._raw[j.id]=j.score; });
  // Blend master grade using current judge weights
  try{ const bl=JudgeWeights.blend(r._raw); r.score=bl.score; r.grade=bl.grade; r.aura=bl.aura; }catch(e){}
  // v608: fold in the harmonic-technique bonus and bend-accuracy penalty from analyseTake
  try{
    const adj=(metrics.harmBonus||0)*100 - (metrics.bendPenalty||0)*100;
    if(adj){
      r.score=Math.max(0,Math.min(100,Math.round(r.score+adj)));
      if(window.JudgeWeights && window.JudgeWeights.letter) r.grade=window.JudgeWeights.letter(r.score);
      const sc=r.score; r.aura = sc>=95?5:sc>=88?4:sc>=78?3:sc>=65?2:sc>=50?1:0;
      r._harmAdj=Math.round((metrics.harmBonus||0)*100); r._bendAdj=Math.round((metrics.bendPenalty||0)*100);
    }
  }catch(e){}
  // v840: green/red turn — play correct notes on YOUR turn
  try{
    if(metrics.turnPlay!=null){
      const tAdj=Math.round((metrics.turnPlay-0.5)*32); // about -16..+16
      r.score=Math.max(0,Math.min(100,Math.round(r.score+tAdj)));
      if(window.JudgeWeights && window.JudgeWeights.letter) r.grade=window.JudgeWeights.letter(r.score);
      const sc=r.score; r.aura = sc>=95?5:sc>=88?4:sc>=78?3:sc>=65?2:sc>=50?1:0;
      r._turnAdj=tAdj;
      r._turnPlay=metrics.turnPlay;
      r._turnGreen=metrics.turnGreen|0;
      r._turnRed=metrics.turnRed|0;
      r._raw=r._raw||{};
      r._raw.turnPlay=Math.round(metrics.turnPlay*100);
    }
  }catch(e){}
  Aura.award(r.aura,reason||'performance');
  lastGrade=r;
  return r;
}
// ── REAL SCORER: analyse a recorded take (recArr) into the 7 metrics, then grade ──
function analyseTake(arr, scaleSemis, scaleRoot){
  if(!arr || arr.length<3) return null;
  const notes=arr.slice().sort((a,b)=>a.t-b.t);
  const N=notes.length;
  const span=(notes[N-1].t-notes[0].t)/1000 || 1;     // seconds
  // pitch-class set of the active scale (for noteChoice / chordTones)
  const inScale=new Set((scaleSemis||[]).map(s=>(((scaleRoot||0)+s)%12+12)%12));
  const triad=new Set([0,2,4].map(i=>{ const s=(scaleSemis||[])[i]; return s==null?-1:(((scaleRoot||0)+s)%12+12)%12; }));
  let inCount=0, triadCount=0;
  const _melodic=notes.filter(n=>!n.harm); const Nm=_melodic.length||1;   // v608: harmonics judged separately, not 'wrong notes'
  _melodic.forEach(n=>{ const pc=((n.m%12)+12)%12; if(inScale.has(pc))inCount++; if(triad.has(pc))triadCount++; });
  // v840: green/red turn discipline
  let _turnTagged=0, _turnGreen=0, _turnRed=0, _turnGreenIn=0, _turnRedIn=0;
  _melodic.forEach(function(n){
    if(n.myTurn==null) return;
    _turnTagged++;
    const pc=((n.m%12)+12)%12;
    const ok=inScale.has(pc);
    if(n.myTurn){ _turnGreen++; if(ok) _turnGreenIn++; }
    else { _turnRed++; if(ok) _turnRedIn++; }
  });
  var turnPlay=null;
  if(_turnTagged>=3){
    const greenRatio=_turnGreen/_turnTagged;
    const greenQuality=_turnGreen?(_turnGreenIn/_turnGreen):0;
    const redRatio=_turnRed/_turnTagged;
    turnPlay=Math.max(0, Math.min(1,
      0.55*greenRatio + 0.35*greenQuality + 0.10*(1-redRatio)
      - 0.40*(_turnRed?((_turnRed-_turnRedIn)/Math.max(1,_turnTagged)):0)
    ));
  }
  // timing: how evenly notes are spaced (groove) — lower variance of inter-onset = tighter
  const iois=[]; for(let i=1;i<N;i++) iois.push(notes[i].t-notes[i-1].t);
  const mean=iois.reduce((a,b)=>a+b,0)/iois.length;
  const varc=iois.reduce((a,b)=>a+(b-mean)*(b-mean),0)/iois.length;
  const cv=Math.sqrt(varc)/(mean||1);                  // coefficient of variation
  const timing=Math.max(0,Math.min(1, 1 - Math.abs(cv-0.5)));   // some variation good, chaos bad
  // space: note density — sweet spot widened (~1.5–6 notes/sec all sound musical)
  const density=N/span;
  const space=Math.max(0,Math.min(1, 1 - Math.abs(density-3)/5));
  // intensity: velocity spread, BUT touchscreens send near-constant velocity, so give a
  // baseline (you're not penalised for the hardware) and let real dynamics lift it.
  const vels=notes.map(n=>n.vel||0.8); const vmin=Math.min(...vels),vmax=Math.max(...vels);
  const intensity=Math.max(0,Math.min(1, 0.55 + (vmax-vmin)/0.5*0.45));
  // bending: pitch range used — 1.5 octaves counts as full expressive range
  const ms=notes.map(n=>n.m); const range=Math.max(...ms)-Math.min(...ms);
  const bending=Math.max(0,Math.min(1, range/18));
  // comping: repeated pitches = motif/return
  const uniq=new Set(ms).size; const comping=Math.max(0,Math.min(1, 1-(uniq/N)));
  // chordTones: a good solo lands on chord tones ~40% of the time (the rest are
  // passing/colour tones), so treat ~0.4 as full marks rather than demanding 100%.
  const chordTones=Math.max(0,Math.min(1, (triadCount/Nm)/0.4));
  // v608: harmonic-technique bonus + bend-accuracy penalty (consumed by gradePerformance)
  const harmCount=notes.filter(n=>n.harm).length;
  const harmBonus=Math.min(0.10, harmCount*0.02);            // ~+2%/harmonic, capped +10%
  let bendPenalty=0;
  try{ const be=window._takeBendErrs||[]; if(be.length>=3){
    const meanErr=be.reduce((a,b)=>a+b,0)/be.length;
    bendPenalty=Math.max(0, Math.min(0.20, (meanErr-0.05)/0.20*0.20)); } }catch(e){}  // grace <0.05st, -20% at 0.25st
  return {
    noteChoice: inCount/Nm,
    chordTones,
    timing, space, intensity, bending, comping,
    harmBonus, bendPenalty,
    turnPlay: turnPlay,
    turnGreen: _turnGreen|0,
    turnRed: _turnRed|0,
    turnTagged: _turnTagged|0
  };
}
function scoreCurrentTake(reason){
  const as = window.ACTIVE_SCALE || {semis:[0,2,4,5,7,9,11], root:0};
  const m=analyseTake(window.getRecArr(), as.semis, as.root);
  if(!m){ return null; }
  return gradePerformance(m, reason||'take');
}


// ─── BACKING TRACKS ────────────────────────────────────────────
const BackingTracks = (function(){
  // Track format: each carries a progression map (chord + bar timing), key, bpm.
  // url empty for now — you'll point these at your hosted audio later.
  // v561: the four demo jams (Slow Blues / Funk Groove / Minor Jam / Mixolydian Vamp)
  //   are gone — obsolete now that real track packs stream from GitHub.
  const TRACKS = [];


  // display name format: title.Key.bpm  (e.g. "Slow Blues.A.66", minor → "Minor Jam.Dm.88")
  function trackName(t){ return t.title+' · '+keyLabel(t.key,t.min)+' · '+t.bpm+' · '+(t.ts||'4/4'); }

  function isUnlocked(t){
    if(t.free) return true;
    try{ const u=JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]'); return u.includes(t.id); }catch(e){ return false; }
  }
  function unlock(id){
    try{ const u=JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]'); if(!u.includes(id)){u.push(id);localStorage.setItem('improvs2_unlocks',JSON.stringify(u));} }catch(e){}
  }

  // ── LEGENDARY BUNDLES: pack + map + backing tracks in one purchase ──────────
  // ── TRACK PACK BUNDLES (v561) ────────────────────────────────────────────────
  //   Buy several packs at once. `was` is derived from PACK_USD so the discount badge
  //   is COMPUTED, never hand-typed — a bundle can't advertise a saving it doesn't give.
  // v563: PRICING LADDER — per-track cost descends: single track > pack > bundle.
  //   A pack is 300 gems; the honest USD reference is what 300 gems cost at the ENTRY
  //   tier ($0.99/100) = $2.97 — what a casual buyer actually pays. PACK 1 is earned
  //   free through level progression, so it carries no bundle value.
  //     single track  60 gems  = $0.594/track
  //     pack         300 gems  = $0.495/track   (17% under singles)
  //     bundle (2pk) $3.99     = $0.333/track   (33% under packs)
  //     bundle (3pk) $4.99     = $0.277/track   (44% under packs)
  const PACK_USD=2.97;
  const FREE_PACKS=['pack1'];
  const BUNDLES=[
    { id:'bundle-1', name:'STARTER BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 2 + 3 \u2014 12 backing tracks (pack 1 is free as you level)',
      price:'$3.99', payUrl:'', colour:'#ffd700', packs:['pack1','pack2','pack3'] },
    { id:'bundle-2', name:'DEEP CUTS BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 4 + 5 \u2014 12 backing tracks, keys and tempos auto-load',
      price:'$3.99', payUrl:'', colour:'#f59e0b', packs:['pack4','pack5'] },
    { id:'bundle-3', name:'DEEP END BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 6 + 7 + 8 \u2014 18 backing tracks, keys and tempos auto-load',
      price:'$4.99', payUrl:'', colour:'#a855f7', packs:['pack6','pack7','pack8'] },
    { id:'bundle-4', name:'LONG PLAYER BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 9 + 10 \u2014 12 backing tracks, keys and tempos auto-load',
      price:'$3.99', payUrl:'', colour:'#22d3ee', packs:['pack9','pack10'] },
    { id:'bundle-5', name:'NIGHT SHIFT BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 11 + 12 + 13 \u2014 18 backing tracks, keys and tempos auto-load',
      price:'$4.99', payUrl:'', colour:'#f472b6', packs:['pack11','pack12','pack13'] },
    { id:'bundle-6', name:'FULL AND YET HUNGER BUNDLE', icon:'\uD83C\uDFB8',
      desc:'Track packs 14 + 15 + 16 \u2014 18 backing tracks, keys and tempos auto-load',
      price:'$4.99', payUrl:'', colour:'#34d399', packs:['pack14','pack15','pack16'] },
  ];
  function paidPacks(b){ return (b.packs||[]).filter(function(p){ return FREE_PACKS.indexOf(p)<0; }); }
  function bundleWas(b){ return paidPacks(b).length*PACK_USD; }
  function bundleNow(b){ return parseFloat(String(b.price).replace(/[^0-9.]/g,''))||0; }
  function bundleOff(b){ const w=bundleWas(b), n=bundleNow(b); return (w>0&&n<w)?Math.round((1-n/w)*100):0; }

  function isBundleUnlocked(b){
    try{ return JSON.parse(localStorage.getItem('improvs2_bundle_unlocks')||'[]').includes(b.id); }catch(e){ return false; }
  }
  function unlockBundle(id){
    try{ const u=JSON.parse(localStorage.getItem('improvs2_bundle_unlocks')||'[]'); if(!u.includes(id)){u.push(id);localStorage.setItem('improvs2_bundle_unlocks',JSON.stringify(u));} }catch(e){}
  }
  function showPreviewModal(url, title){
    let m=document.getElementById('btPreviewModal');
    if(!m){
      m=document.createElement('div'); m.id='btPreviewModal';
      m.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.88);display:none;flex-direction:column;align-items:center;justify-content:center;';
      m.innerHTML='<div style="background:#0a0f1e;border:1px solid #2563eb;border-radius:10px;padding:16px;max-width:360px;width:92%;">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
        +'<div id="btPvTitle" style="color:#dbeafe;font-weight:900;font-size:0.82em;font-family:Bangers,cursive;"></div>'
        +'<button id="btPvClose" style="background:none;border:none;color:#888;font-size:1.2em;cursor:pointer;">✕</button>'
        +'</div>'
        +'<iframe id="btPvFrame" style="width:100%;height:160px;border:none;border-radius:6px;" allow="autoplay"></iframe>'
        +'<div style="color:#667;font-size:0.6em;margin-top:8px;text-align:center;">preview streams support the creator via SoundCloud/YouTube</div>'
        +'</div>';
      m.addEventListener('click',function(e){ if(e.target===m){m.style.display='none';document.getElementById('btPvFrame').src='';} });
      m.querySelector('#btPvClose').addEventListener('click',function(){m.style.display='none';document.getElementById('btPvFrame').src='';});
      document.body.appendChild(m);
    }
    document.getElementById('btPvTitle').textContent=title;
    document.getElementById('btPvFrame').src=url||'about:blank';
    m.style.display='flex';
  }
  // v561: a bundle grants TRACK PACK ownership — no sample-pack download involved.
  function grantBundlePacks(b){
    try{
      (b.packs||[]).forEach(function(pid){ window.TrackPacks && TrackPacks.unlock && TrackPacks.unlock(pid); });
      unlockBundle(b.id);
      try{ window.TrackPacks && TrackPacks.render(); }catch(e){}
      try{ window.autoSaveBackup && window.autoSaveBackup('bundle:'+b.id); }catch(e){}
      try{ window.flashAurora && flashAurora(b.colour,0.7,1800); }catch(e){}
      renderBundles();
    }catch(e){ alert('Unlock failed: '+e.message); }
  }

  function renderBundles(){
    const host=document.getElementById('btBundleList'); if(!host) return;
    host.innerHTML='';
    BUNDLES.forEach(function(b){
      const open=isBundleUnlocked(b);
      const off=bundleOff(b), was=bundleWas(b);
      const names=(paidPacks(b)).map(function(id){
        try{ const p=(window.TrackPacks?TrackPacks.packs:[]).find(function(x){return x.id===id;}); return p?p.name:id.toUpperCase(); }
        catch(e){ return id.toUpperCase(); }
      }).join(' + ');
      const div=document.createElement('div');
      div.style.cssText='background:#0d1b33;border:1px solid #1e3a6e;border-left:3px solid '+b.colour+';border-radius:6px;padding:10px 12px;';
      div.innerHTML='<div style="display:flex;align-items:flex-start;gap:10px;">'
        +'<div style="font-size:1.6em;">'+b.icon+'</div>'
        +'<div style="flex:1;">'
          +'<div style="color:'+b.colour+';font-weight:900;font-size:0.82em;font-family:Bangers,cursive;letter-spacing:0.05em;">\u2605 '+b.name+'</div>'
          +'<div style="color:#9aa;font-size:0.62em;margin-top:3px;">'+b.desc+'</div>'
          +'<div style="color:#667;font-size:0.58em;margin-top:2px;">\uD83D\uDCBF '+names+'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;">'
          +(open
            ? '<span style="color:#00cc66;font-size:0.65em;font-weight:900;">\u2714 OWNED</span>'
            : (off>0?'<span style="background:'+b.colour+';color:#000;border-radius:3px;padding:1px 6px;font-size:0.56em;font-weight:900;letter-spacing:0.5px;">'+off+'% OFF</span>':'')
              +'<span style="color:#556;font-size:0.6em;text-decoration:line-through;">$'+was.toFixed(2)+'</span>'
              +'<span style="color:'+b.colour+';font-weight:900;font-size:0.78em;">'+b.price+'</span>'
              +'<button data-bgpay="'+b.id+'" style="padding:5px 10px;background:#0e7a4f;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.65em;cursor:pointer;">\u2605 Buy Bundle</button>')
        +'</div></div>';
      host.appendChild(div);
    });
    host.querySelectorAll('[data-bgpay]').forEach(function(btn){
      btn.addEventListener('click',function(){
        const b=BUNDLES.find(function(x){return x.id===btn.dataset.bgpay;});
        if(!b) return;
        if(b.payUrl){ window.open(b.payUrl,'_blank'); return; }
        // v561: routes through the in-app buy dialog; on success the packs are granted.
        if(window.showBuyConfirm) showBuyConfirm(b.name, b.price, function(){ grantBundlePacks(b); });
        else if(confirm(b.name+' \u2014 '+b.price+'?')) grantBundlePacks(b);
      });
    });
  }

  function render(){
    const host=document.getElementById('btList');
    if(!host) return;
    host.innerHTML='';
    TRACKS.forEach(function(t){
      const open=isUnlocked(t);
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;background:#0d1426;border:1px solid #1e3a6e;border-radius:4px;padding:8px 10px;';
      const prevBtn=t.previewUrl?'<button data-prev="'+t.id+'" title="Preview via SoundCloud/YouTube" style="padding:4px 9px;background:#1c2a4e;color:#7eb0ff;border:1px solid #2563eb;border-radius:4px;font-weight:900;font-size:0.68em;cursor:pointer;">🔊</button>':'';
      row.innerHTML=
        '<div style="flex:1;">'+
          '<div style="color:#dbeafe;font-weight:900;font-size:0.82em;font-family:Bangers,cursive;">'+trackName(t)+(open?'':' 🔒')+'</div>'+
          '<div style="color:#6b8cc4;font-size:0.68em;font-family:Bangers,cursive;">'+t.key+' · '+t.bpm+' BPM · '+(t.ts||'4/4')+' · '+t.genre+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:5px;align-items:center;">'+
          prevBtn+
          (open
            ? '<button data-play="'+t.id+'" style="padding:4px 12px;background:'+(_tk.playing&&_tk.id===t.id?'#dc2626':'#2563eb')+';color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.72em;cursor:pointer;">'+(_tk.playing&&_tk.id===t.id?'■ STOP':'▶ JAM')+'</button>'
            : (t.aura_cost?'<button data-aura="'+t.id+'" title="Buy with '+t.aura_cost+' aura" style="padding:4px 9px;background:#1a2a1a;color:#9AE66A;border:1px solid #4a8a4a;border-radius:4px;font-weight:900;font-size:0.68em;cursor:pointer;">🪙 '+t.aura_cost+'</button>':'')+
              '<button data-tok="'+t.id+'" title="Unlock with '+(t.cost||1)+' token'+((t.cost||1)>1?'s':'')+'" style="padding:4px 9px;background:#6d28d9;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.68em;cursor:pointer;">🎟 '+(t.cost||1)+'</button>'+
              (typeof Loot!=='undefined'&&Loot.rareTokens>0?'<button data-rare="'+t.id+'" style="padding:4px 9px;background:#1d4ed8;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.68em;cursor:pointer;">🔷 1</button>':'')+
              '<button data-buy="'+t.id+'" title="Google Pay" style="padding:4px 9px;background:#0e7a4f;color:#fff;border:none;border-radius:4px;font-weight:900;font-size:0.68em;cursor:pointer;">⚡ '+(t.price||'$0.99')+'</button>')+
        '</div>';
      host.appendChild(row);
    });
    host.querySelectorAll('[data-play]').forEach(function(b){ b.addEventListener('click',function(){ if(_tk.playing&&_tk.id===b.dataset.play) stopTrack(); else startTrack(b.dataset.play); }); });
    host.querySelectorAll('[data-prev]').forEach(function(b){ b.addEventListener('click',function(){ const t=TRACKS.find(function(x){return x.id===b.dataset.prev;}); if(t&&t.previewUrl) showPreviewModal(t.previewUrl,trackName(t)); else alert('No preview URL set for this track yet. Add a SoundCloud or YouTube embed URL to previewUrl.'); }); });
    host.querySelectorAll('[data-aura]').forEach(function(b){ b.addEventListener('click',function(){ const t=TRACKS.find(function(x){return x.id===b.dataset.aura;}); if(!t) return; if(typeof Aura!=='undefined'&&Aura.spend&&Aura.spend(t.aura_cost)){ unlock(t.id); render(); } else alert('Not enough aura. You need '+t.aura_cost+' — keep jamming to earn more!'); }); });
    host.querySelectorAll('[data-tok]').forEach(function(b){ b.addEventListener('click',function(){ const t=TRACKS.find(function(x){return x.id===b.dataset.tok;}); const cost=(t&&t.cost)||3; if(Tokens.spend(cost)){ unlock(b.dataset.tok); try{window.autoSaveBackup('track-tok:'+b.dataset.tok);}catch(e){} render(); } else alert('Not enough tokens. You have '+Tokens.balance+' 🎟, need '+cost+'.'); }); });
    host.querySelectorAll('[data-buy]').forEach(function(b){ b.addEventListener('click',function(){ const t=TRACKS.find(function(x){return x.id===b.dataset.buy;}); instantBuy(b.dataset.buy,(t&&t.price)||'$0.99',t&&trackName(t),function(){ unlock(b.dataset.buy); try{window.autoSaveBackup('track-iap:'+b.dataset.buy);}catch(e){} render(); }); }); });
    host.querySelectorAll('[data-rare]').forEach(function(b){ b.addEventListener('click',function(){ if(typeof Loot!=='undefined'&&Loot.spendRare(1)){ unlock(b.dataset.rare); try{window.autoSaveBackup('track-rare:'+b.dataset.rare);}catch(e){} render(); } else alert('No rare tokens.'); }); });
    renderBundles();
  }
  // ── chord parser: 'A7' -> {root, pcs (for scale), midis (to comp)} ──
  const LETTER={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  function parseChord(sym){
    const m=sym.match(/^([A-G])([#b]?)(.*)$/); if(!m) return null;
    let root=LETTER[m[1]]; if(m[2]==='#')root++; if(m[2]==='b')root--;
    root=((root%12)+12)%12;
    const q=m[3];
    let ints;
    if(/^m(?!aj)/.test(q))      ints=[0,3,7];          // minor
    else                        ints=[0,4,7];          // major (default)
    if(/m?7/.test(q) && !/maj7/.test(q)) ints=ints.concat([10]);  // dom/min 7
    if(/maj7/.test(q))          ints=ints.concat([11]);
    if(/9/.test(q))             ints=ints.concat([10,14]);
    const uniq=[...new Set(ints.map(i=>(root+i)%12))];
    // voice the comp around octave 3 (midi 48 = C3)
    const midis=ints.map(i=>48+root+i);
    return { root, pcs:uniq, midis };
  }

  let _tk={ timers:[], comp:[], playing:false, id:null, autoRec:false };
  function stopComp(){ _tk.comp.forEach(v=>{try{v.release();}catch(e){}}); _tk.comp=[]; }
  function playComp(midis){
    stopComp();
    midis.forEach(mi=>{ try{ const v=window.makeVoice(mi, 0.32, midis.length); _tk.comp.push(v); }catch(e){} });
  }

  // v564: ONE parser for track keys. tracks.json writes minor as a suffix ("Em","F#m",
  //   "Amin"); an explicit boolean t.min still wins. Before this, autoProg() looked "Em"
  //   up in a note table, missed, and fell back to index 0 -> every minor track in every
  //   pack drove a C-major I-IV-V progression into the scale-follow engine.
  function parseKey(t){
    // v745: tracks.json writes minor as a suffix ("Em","F#m","Amin"). An explicit
    //   t.min===true also counts. Never let t.min===false override a minor suffix —
    //   the jam propose path used to force min:false for every track without a min
    //   field, which turned Restless (Em) into E major.
    const raw=String((t&&t.key)||'C').trim();
    const fromKey=/min$/i.test(raw) || /^[A-G](?:#|b)?m$/i.test(raw);
    const min=fromKey || t.min===true;
    return { root: raw.replace(/(?:maj|min|m)$/i,''), min: min };
  }
  function updateNowPlaying(t){
    const np=document.getElementById('btNowPlaying');
    if(!np) return;
    if(!t){ np.style.display='none'; return; }
    np.style.display='flex';
    document.getElementById('btNpName').textContent=trackName(t);
    const _k=parseKey(t);
    document.getElementById('btNpKey').textContent=keyLabel(_k.root,_k.min);
    document.getElementById('btNpBpm').textContent=t.bpm+' BPM';
  }
  function startTrack(idOrTrack){
    // accept either a TRACKS id (string) or a full track object (from a pack / DLC).
    const t=(typeof idOrTrack==='object' && idOrTrack) ? idOrTrack : TRACKS.find(x=>x.id===idOrTrack);
    if(!t) return;
    window.__lastBkTrack=t;   // v670: remember it so PLAY can restart the same track after STOP
    window.__restartBkTrack=function(){ try{ startTrack(window.__lastBkTrack); }catch(e){} };
    const id=t.id;
    if(_tk.playing){ stopTrack(); if(_tk.id===id){ render(); return; } }
    try{ window.ensureAudio(); }catch(e){}
    // v466: tracks.json writes minor as a key suffix ("Em","F#m","Amin") — parse it here; an
    //   explicit boolean t.min still wins. Downstream only ever sees the bare root note.
    // v745: same rule as parseKey — minor suffix on key always wins over a stale min:false
    const _pk=parseKey(t);
    const _kRoot=_pk.root, _kMin=_pk.min;
    // auto-select the track's KEY SIGNATURE and set the TEMPO
    try{ if(window.setAppKeyAndTempo) window.setAppKeyAndTempo(_kRoot, _kMin, t.bpm); }catch(e){}
    // v676 ROOT FIX: only apply a real "n/d" signature. 'free' (and anything non-numeric) used to
    //   produce mBeats=NaN / mDen=undefined -> the beat interval became NaN -> setTimeout(...,NaN)
    //   fires immediately, every time = the runaway click storm. FREE arms its own meter engine.
    try{ if(t.ts && window.setAppTimeSignature && /^\s*\d+\s*\/\s*\d+\s*$/.test(String(t.ts))){
      var _p=String(t.ts).split('/').map(Number);
      if(isFinite(_p[0]) && isFinite(_p[1]) && _p[0]>0 && _p[1]>0) window.setAppTimeSignature(_p[0],_p[1]);
    } }catch(e){}
    updateNowPlaying(t);
    try{ const rd=document.getElementById('recDot'); if(rd) rd.dataset.tip=t.title+' ('+_kRoot+(_kMin?'m':'')+' · '+t.bpm+' BPM) loaded — tap ● to record'; }catch(e){}

    // v564: bar length follows the track's ts (3/4 tracks were looping a beat long)
    const _tsTop=(function(){ try{ const n=parseInt(String(t.ts||'4/4').split('/')[0],10); return (n>=1&&n<=16)?n:4; }catch(e){ return 4; } })();
    const beatSec=60/t.bpm, barSec=beatSec*_tsTop;
    const prog=(t.prog&&t.prog.length)?t.prog:autoProg(t);   // packs without a written prog get one
    const lastBar=Math.max(...prog.map(p=>p.bar))+3;  // pad a couple bars
    const loopSec=lastBar*barSec;
    _tk.playing=true; _tk.id=id;

    // v749: pick a walk at random so backing tracks don't all stagnate on GROUP.
    //   Pool skews away from group; skips custom/chord/free (need setup or own engine).
    try{
      if(typeof window.__pickWalkForTrack==='function') window.__pickWalkForTrack(t);
    }catch(e){}

    // If the track ships a real audio file (DLC asset), load & loop it as the backing.
    //   The chord data still drives the scale-follow; we just skip the synth comp so they
    //   don't stack. If the file fails to load (offline / bad URL), we fall back to comp.
    _tk.useAudio=false;
    const audioSrc=t.audioUrl||t.audio||t.url;
    if(audioSrc){
      _tk.useAudio=true;
      loadAndLoopTrackAudio(audioSrc);
    }

    function scheduleLoop(){
      // schedule each chord change within one loop, then reschedule
      prog.forEach(p=>{
        const at=(p.bar-1)*barSec*1000;
        _tk.timers.push(setTimeout(()=>{
          const ch=parseChord(p.chord); if(!ch) return;
          if(!_tk.useAudio) playComp(ch.midis);          // hear the chord (synth) — skipped when real audio plays
          // v571: only drive the scale when the user is actually in a chord-following
          //   walk mode. GROUP/ROAM/JIMI/GLIDE/CUSTOM mean the walk engine owns the
          //   scale; stomping it here on every chord boundary made walks look frozen
          //   whenever a backing track was loaded (the walk picked, this overwrote it).
          try{
            const wm=window.__getWalkMode?window.__getWalkMode():'group';
            if(wm!=='chord' && wm!=='bktrk') return;     // walk engine owns the scale — leave it alone
            const inst=window.INST[window.getActivePrefix()];
            const st=inst.getScale ? inst.getScale() : {key:_kRoot,mode:_kMin?'AEOLIAN':'IONIAN',alt:'NA'};
            const nx=window.nextScaleForChord(ch.pcs, {key:st[0]||st.key,mode:st[1]||st.mode,alt:st[2]||st.alt});
            inst.setScale(nx[0],nx[1],nx[2]);
          }catch(e){}
        }, at));
      });
      _tk.timers.push(setTimeout(scheduleLoop, loopSec*1000));  // loop
    }
    scheduleLoop();
    render();   // refresh buttons to STOP
  }
  // Load a real audio file and loop it as the backing track. Used when a pack track carries
  //   an audioUrl (DLC asset — folder-relative path or remote URL). Guarded: any failure
  //   leaves _tk.useAudio false so the synth-comp engine takes over on the next loop.
  let _trkAudioSrc=null, _trkGen=0;
  function stopTrackAudio(){ _trkGen++;   // invalidate any in-flight async load so a late decode can't start an orphan loop
    if(_trkAudioSrc){ try{_trkAudioSrc.stop();}catch(e){} _trkAudioSrc=null; } window.__bkLoaded=false; }   // v667
  function loadAndLoopTrackAudio(url){
    stopTrackAudio();
    const gen=_trkGen;                     // if a stop/restart happens before decode resolves, gen won't match → bail
    try{
      window.ensureAudio(); const ac=window.getAC&&window.getAC(); if(!ac){ _tk.useAudio=false; return; }
      // v677: local-first. Vault returns the on-disk copy if we already own it, otherwise it
      //   downloads once and keeps it - so a purchased track costs GitHub bandwidth exactly once.
      const _get = (window.Vault && window.Vault.ready) ? window.Vault.trackBytes(url)
                                                        : fetch(url).then(r=>r.arrayBuffer());
      _get.then(ab=>ac.decodeAudioData(ab)).then(buf=>{
        if(!_tk.playing || gen!==_trkGen){ return; }   // stale load — abort
        const playOnce=!!window.__jamPlayOnce;
        const s=ac.createBufferSource(); s.buffer=buf; s.loop=!playOnce;
        if(!playOnce){ s.loopStart=0; s.loopEnd=buf.duration; }
        s.connect((window.getBkGain&&window.getBkGain())||ac.destination);
        (function(_s,_buf,_once){
          function go(){
            if(!_tk.playing || gen!==_trkGen) return;
            try{ _s.start(); }catch(e){}
            _trkAudioSrc=_s; window.__bkLoaded=true;
            // v816: the moment BK audio is audible, every client records
            if(_once || window.__jamPlayOnce || window.__jamRoundActive){
              try{ if(typeof window.__jamArmRecordNow==='function') window.__jamArmRecordNow(); }catch(e){}
            }
            if(_once){
              try{
                const ms=Math.max(1000, Math.floor((_buf.duration||0)*1000)+250);
                setTimeout(function(){
                  if(!_tk.playing || gen!==_trkGen) return;
                  try{ if(typeof window.__jamOnTrackEnded==='function') window.__jamOnTrackEnded(); }catch(e){}
                }, ms);
              }catch(e){}
            }
          }
          const epoch = window._jamSyncEpoch;
          if(epoch!=null){
            window._jamSyncEpoch=null;
            const delay=Math.max(0, epoch-Date.now());
            setTimeout(go, delay);
          } else {
            go();
          }
        })(s, buf, playOnce);
        s.onended=function(){
          if(!_tk.playing || gen!==_trkGen || _trkAudioSrc!==s) return;
          if(playOnce || window.__jamPlayOnce){
            try{ if(typeof window.__jamOnTrackEnded==='function') window.__jamOnTrackEnded(); }catch(e){}
            return;
          }
          try{ const s2=ac.createBufferSource(); s2.buffer=buf; s2.loop=true; s2.loopStart=0; s2.loopEnd=buf.duration;
               s2.connect((window.getBkGain&&window.getBkGain())||ac.destination); s2.start(); _trkAudioSrc=s2; s2.onended=s.onended;
          }catch(e){}
        };
        // v570: cache the decoded buffer so offline renders (WAV dry fallback, LIB+ save)
        //   can mix the SAME backing at the fader level. Previously only user-uploaded
        //   backing set _bkTrkBuf — pack tracks left it null, so every re-synth was dry.
        try{ window.__setBkBufQuiet && window.__setBkBufQuiet(buf); }catch(e){}
        try{ const ct=_tk.id&&TRACKS.find(function(x){return x.id===_tk.id;});
             window.__curBkTrack={id:_tk.id, name:(ct&&ct.title)||_tk.id}; }catch(e){}
      }).catch(e=>{ console.log('[PACK] audio load failed — falling back to synth comp:',e&&e.message); _tk.useAudio=false; });
    }catch(e){ _tk.useAudio=false; }
  }
  // A pack track may carry no written progression — generate a simple I–IV–V–I in its key
  // so the chord-follow engine still drives the scales. (DLC packs can ship a real prog.)
  function autoProg(t){
    const L={C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11,
             Db:1,Eb:3,Gb:6,Ab:8,Bb:10};
    const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const k=parseKey(t);                       // v564: "Em" -> root E, minor
    const r=L[k.root]!=null?L[k.root]:0;
    if(k.min){
      // natural minor: i - iv - v(7) - i   (the V stays minor-flavoured as a dominant 7)
      const i=NAMES[r]+'m', iv=NAMES[(r+5)%12]+'m', v=NAMES[(r+7)%12]+'7';
      return [{bar:1,chord:i},{bar:3,chord:iv},{bar:5,chord:v},{bar:7,chord:i}];
    }
    const I=NAMES[r], IV=NAMES[(r+5)%12], V=NAMES[(r+7)%12]+'7';
    return [{bar:1,chord:I},{bar:3,chord:IV},{bar:5,chord:V},{bar:7,chord:I}];
  }
  function stopTrack(){
    _tk.timers.forEach(clearTimeout); _tk.timers=[];
    stopComp(); stopTrackAudio(); _tk.playing=false; _tk.useAudio=false;
    try{ const rd=document.getElementById('recDot'); if(rd) rd.dataset.tip='Record audio from your microphone.'; }catch(e){}
    _tk.id=null;
    updateNowPlaying(null);
    render();
  }

  // global hook so Loot chests can grant a real track unlock (TRACKS is private to this module)
  window.grantRandomTrackUnlock=function(){
    const u=(()=>{try{return JSON.parse(localStorage.getItem('improvs2_unlocks')||'[]');}catch(e){return [];}})();
    const locked=TRACKS.filter(t=>!t.free && !u.includes(t.id));
    if(!locked.length) return null;
    const t=locked[Math.floor(Math.random()*locked.length)];
    unlock(t.id); render();
    return trackName(t);
  };
  window.btRefresh=render;
  return { render, startTrack, stopTrack, getCurrentTrack:function(){
    // v744: prefer the actively-playing track; otherwise the last one the user started
    //   (so "PROPOSE MY LOADED TRACK" works after STOP, or before re-pressing JAM).
    if(_tk.playing && _tk.id!=null){
      return TRACKS.find(function(x){return x.id===_tk.id;}) || window.__lastBkTrack || null;
    }
    return window.__lastBkTrack || null;
  } };
})();
window.BackingTracks=BackingTracks;

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('btToggle'), panel=document.getElementById('btPanel');
  if(btn&&panel){
    btn.addEventListener('click',()=>{
      const show=panel.style.display==='none';
      panel.style.display=show?'block':'none';
      if(show){ BackingTracks.render(); try{TrackPacks.refresh();}catch(e){}
        // Remote backing-track store: pull the GitHub manifest once, then merge. Streams MP3s
        //   from the CDN via the existing audioUrl engine. Silent + offline-safe (synth fallback).
        try{ if(!window.__remoteTracksTried){ window.__remoteTracksTried=true;
          TrackPacks.loadFromURL('https://raw.githubusercontent.com/trickishxsham/backingtracks/main/tracks.json?t='+Date.now())
            .then(function(ok){ if(ok) try{TrackPacks.refresh();}catch(e){} }); } }catch(e){}
        try{AdManager.onFeatureOpen('backing-tracks');}catch(e){} }
    });
  }
});




try{ window.Scoring=Scoring; }catch(e){}
try{ window.Tokens=Tokens; }catch(e){}
try{ if(typeof Gems!=='undefined') window.Gems=Gems; }catch(e){}
try{ if(typeof Loot!=='undefined') window.Loot=Loot; }catch(e){}
window.registerModule('scoring', {
  version: MODULE_VERSION,
  isStub: false
});
console.log('[modules] scoring v' + MODULE_VERSION);
})();
