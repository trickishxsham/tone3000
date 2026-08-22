// modules/judge/judge.js
// version: 4.9.8.860
// JudgePanel grade screen. Uses assets/images/judge-bg.jpg.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';

window.JudgePanel=(function(){
  var BG=(typeof window.__rootRelative==='function'?window.__rootRelative('assets/images/judge-bg.jpg'):'../assets/images/judge-bg.jpg');
  // paddle centres + nameplate, measured from the artwork as fractions of its 1402x1122 size.
  // order matches the app's judges left->right.
  var SLOTS=[
    {x:0.068, y:0.643, name:'BENGINE'},
    {x:0.265, y:0.643, name:'ARTIE'},
    {x:0.434, y:0.643, name:'BILLIE'},
    {x:0.597, y:0.643, name:'HOWIE'},
    {x:0.745, y:0.643, name:'JACKIE'},
    {x:0.894, y:0.643, name:'FREDDIE'}
  ];
  function gc(gr){ return gr==='S'?'#FFDD00':gr&&gr[0]==='A'?'#00CC66':gr==='B'?'#78D4EF':gr==='C'?'#FF8844':'#F0483A'; }
  var el=null;
  function build(){
    if(el) return el;
    el=document.createElement('div'); el.id='judgePanel';
    el.style.cssText='position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);';
    var stage=document.createElement('div');
    stage.style.cssText='position:relative;width:min(96vw,720px);aspect-ratio:1152/914;background-image:url('+BG+');background-size:100% 100%;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.7);';
    stage.id='jpStage';
    el.appendChild(stage);
    el.addEventListener('click',function(e){ if(e.target===el) hide(); });
    document.body.appendChild(el);
    return el;
  }
  function hide(){ if(el) el.style.display='none'; }
  function show(g){
    build();
    var stage=document.getElementById('jpStage');
    // clear previous
    Array.prototype.slice.call(stage.querySelectorAll('.jpGrade,.jpBubble,.jpClose,.jpFace')).forEach(function(n){n.remove();});
    var judges=(g&&g.judges)||[];
    // v700 fix: BENGINE is the base scoring engine, the other five paddles are the named judges.
    //   Map each paddle to its judge by NAME (not array position, which skipped Freddie).
    function findJudge(nm){
      nm=(nm||'').toLowerCase();
      for(var k=0;k<judges.length;k++){
        var j=judges[k];
        if(((j.id||'')+'').toLowerCase()===nm || ((j.name||'')+'').toLowerCase()===nm) return j;
      }
      return null;
    }
    var baseGrade=(g&&g._raw&&g._raw.scoring!=null && window.JudgeWeights)
                    ? window.JudgeWeights.letter(Math.round(g._raw.scoring)) : (g&&g.grade)||'-';
    SLOTS.forEach(function(sl,i){
      var j = (sl.name==='BENGINE') ? {name:'BENGINE',grade:baseGrade,colour:'#9aa',comment:'The base scoring engine.'} : findJudge(sl.name);
      var grade = j ? j.grade : '-';
      // v713: a BIG invisible tap-zone over the character's face/portrait - tapping the paddle
      //   chip is fiddly, so the whole character above the paddle now speaks too.
      var face=document.createElement('button'); face.className='jpFace';
      face.style.cssText='position:absolute;left:'+(sl.x*100)+'%;top:10%;'+
        'transform:translateX(-50%);width:15%;height:52%;border:none;background:transparent;'+
        'cursor:pointer;padding:0;';
      face.dataset.lifted='1';   // belt-and-braces: skip the skinner entirely, even if it runs before this element exists
      face.onclick=function(ev){ ev.stopPropagation(); toggleBubble(stage,sl,j,i); };
      stage.appendChild(face);
      // grade chip over the paddle
      var chip=document.createElement('button'); chip.className='jpGrade';
      chip.textContent=grade;
      chip.style.cssText='position:absolute;left:'+(sl.x*100)+'%;top:'+(sl.y*100)+'%;'+
        'transform:translate(-50%,-50%);width:12%;aspect-ratio:1;border-radius:50%;border:none;cursor:pointer;'+
        'font-family:Bangers,cursive;font-size:clamp(14px,3.4vw,30px);color:#111;background:'+gc(grade)+';'+
        'box-shadow:0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(255,255,255,0.85);';
      chip.onclick=function(ev){ ev.stopPropagation(); toggleBubble(stage,sl,j,i); };
      stage.appendChild(chip);
    });
    var close=document.createElement('button'); close.className='jpClose'; close.textContent='\u2715';
    close.style.cssText='position:absolute;top:2%;right:2%;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;background:#000;color:#fff;font-size:18px;opacity:0.85;';
    close.onclick=hide; stage.appendChild(close);
    el.style.display='flex';
  }
  function toggleBubble(stage,sl,j,i){
    var existing=stage.querySelector('.jpBubble[data-i="'+i+'"]');
    Array.prototype.slice.call(stage.querySelectorAll('.jpBubble')).forEach(function(n){n.remove();});
    if(existing) return;   // clicking the open one closes it
    if(!j) return;
    var b=document.createElement('div'); b.className='jpBubble'; b.setAttribute('data-i',String(i));
    var txt=j.comment||j.text||'(no comment)';
    var coach=j.coach||'';
    b.innerHTML='<div style="font-weight:900;color:'+(j.colour||'#333')+';margin-bottom:3px;">'+j.name+' \u00b7 '+j.grade+'</div>'+
                '<div style="color:#222;font-style:italic;line-height:1.35;">'+txt+'</div>'+
                (coach?('<div style="margin-top:5px;padding-top:5px;border-top:1px dashed #999;color:#333;font-size:0.94em;">\u25B8 '+((j.coachKind==='praise')?'nice: ':'work on: ')+coach+'</div>'):'');
    // v709: the judge SPEAKS when their bubble opens (panel screen). id: slot 0 = bengine (base engine).
    var _vid=(j.id||(i===0?'bengine':(sl.name||'').toLowerCase()));
    try{ var _cp2=(window.JudgeVoices&&window.JudgeVoices.coachPhrase)?window.JudgeVoices.coachPhrase(j.coachKind,coach):(coach?('. Work on: '+coach):''); window.speakJudge && window.speakJudge(_vid, txt+_cp2); }catch(e){}
    try{ window.JudgeVoices && window.JudgeVoices.diag && window.JudgeVoices.diag(); }catch(e){}
    var leftPct=Math.max(3,Math.min(71,sl.x*100-11));
    if(leftPct+26>97) leftPct=97-26;   // v714: never let the bubble run off the right edge (Freddie)
    b.style.cssText='position:absolute;left:'+leftPct+'%;top:8%;width:26%;min-width:150px;max-width:280px;'+
      'background:#fdf6e3;border:2px solid #333;border-radius:12px;padding:9px 11px;font-size:clamp(10px,2.2vw,14px);'+
      'box-shadow:0 6px 18px rgba(0,0,0,0.5);z-index:5;';
    // little pointer tail
    var tail=document.createElement('div');
    tail.style.cssText='position:absolute;left:50%;bottom:-11px;transform:translateX(-50%);width:0;height:0;border:11px solid transparent;border-top-color:#333;';
    b.appendChild(tail);
    b.onclick=function(ev){ ev.stopPropagation(); };
    stage.appendChild(b);
  }
  return { show:show, hide:hide };
})();


window.registerModule('judge', {
  version: MODULE_VERSION,
  isStub: false
});
console.log('[modules] judge v' + MODULE_VERSION);
})();
