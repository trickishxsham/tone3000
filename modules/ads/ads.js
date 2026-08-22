// modules/ads/ads.js
// version: 4.9.8.860
// AdManager + AdEngine (mediation gatekeeper). nativeads.js stays external.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';

// ─── AD TRIGGER MANAGER (mediation-ready) ──────────────────────
// ── ADS — single gatekeeper for WHEN ads fire. The ad NETWORK is AppLovin MAX mediation
//   (AdMob as a bidder), wired by a native Capacitor plugin that defines window.NativeAds.
//   Until that exists (web build, file:// testing), the bridge is a no-op: triggers are
//   evaluated and logged so the timing logic is testable, but nothing is ever shown.
//   Frequency/on-off is tunable live from GitHub (see loadAdConfig); the hard COMPLIANCE
//   rules (no ads during play, 20s grade floor, no back-to-back) stay baked in elsewhere.
const AdManager = (function(){
  const cfg = {
    MIN_GAP_MS:        90000,    // hard floor between interstitials
    SESSION_MAX:       8,        // ceiling per app session
    FIRST_AD_DELAY_MS: 120000,   // no interstitial in the first 2 min
    SHOW_PROB:         0.3,      // ~1 in 3 eligible+gated triggers actually shows
    SCALE_TRIGGER_N:   15,       // scale-change cadence before that trigger is even eligible
    unlocked:          false,
    rewardedEnabled:   true,
    placements:        { gradeComplete:true, featureClose:true, export:true },
    bridge: {                    // replaced by window.NativeAds in the native build
      isReady:          function(){ return false; },
      show:             function(){},
      load:             function(){},
      isRewardedReady:  function(){ return false; },
      showRewarded:     function(){ return false; },
      loadRewarded:     function(){},
    },
    onShow: function(){},        // injected: suspend AudioContext, stop metronome + backing
    onHide: function(){},        // injected: resume AudioContext (do NOT auto-restart play)
    onImpression: function(){},  // v461: injected by AdEngine — per-day revenue ledger
    log:    function(){},
  };

  const sessionStart   = Date.now();
  let   lastShown      = 0;
  let   shownThisSession = 0;
  let   showing        = false;
  let   scaleCount     = 0;
  let   pendingReward  = null;   // v461: reward callback awaiting native didRewardUser / sim CLAIM

  function configure(opts){
    if(!opts) return;
    Object.keys(opts).forEach(function(k){
      if(opts[k] === undefined) return;
      if(k === 'bridge')          cfg.bridge     = Object.assign({}, cfg.bridge, opts.bridge);
      else if(k === 'placements') cfg.placements = Object.assign({}, cfg.placements, opts.placements);
      else cfg[k] = opts[k];
    });
  }
  function setUnlocked(v){ cfg.unlocked = !!v; }

  function eligible(reason){
    if(cfg.unlocked) return false;                                   // paid → zero ads
    if(showing) return false;                                        // never stack
    if(window.isTransportPlaying && window.isTransportPlaying()){ cfg.log('blocked: transport playing', reason); return false; }  // HARD RULE: never interrupt play, no exceptions
    if(Date.now() - sessionStart < cfg.FIRST_AD_DELAY_MS) return false;
    if(shownThisSession >= cfg.SESSION_MAX) return false;
    if(Date.now() - lastShown < cfg.MIN_GAP_MS) return false;        // 90s floor
    if(!cfg.bridge.isReady()){ cfg.log('eligible, no ad ready', reason); return false; }  // bail, don't block UI
    if(Math.random() > cfg.SHOW_PROB){ cfg.log('thinned', reason); return false; }        // skip eligible slots
    return true;
  }

  // THE gatekeeper. Returns true only if an ad is actually being shown.
  function showInterstitial(reason){
    if(!eligible(reason)) return false;
    showing = true; lastShown = Date.now(); shownThisSession++;
    cfg.log('interstitial', reason, shownThisSession + '/' + cfg.SESSION_MAX);
    try{ cfg.onImpression('interstitial', reason); }catch(e){}
    try{ cfg.onShow(); }catch(e){}
    try{ cfg.bridge.show(); }catch(e){}      // native fires didHide → adHidden()
    return true;
  }
  // native bridge calls this on didHide / didFailToDisplay
  function adHidden(){
    showing = false;
    try{ cfg.onHide(); }catch(e){}
    try{ cfg.bridge.load(); }catch(e){}      // preload the next immediately
  }

  // Rewarded — opt-in, the revenue engine. Returns whether an ad was shown. (Native build
  //   should grant the in-app reward in the bridge's didRewardUser callback, not on close.)
  function showRewarded(reason, onReward){
    if(cfg.unlocked) return false;
    if(!cfg.rewardedEnabled) return false;
    if(showing) return false;
    if(!cfg.bridge.isRewardedReady()){ cfg.log('rewarded not ready', reason); return false; }
    pendingReward = (typeof onReward === 'function') ? onReward : null;
    showing = true;
    cfg.log('rewarded', reason);
    try{ cfg.onImpression('rewarded', reason); }catch(e){}
    try{ cfg.onShow(); }catch(e){}
    var ok=false; try{ ok = cfg.bridge.showRewarded(reason); }catch(e){}
    return ok !== false;
  }
  // native didRewardUser (or sim CLAIM) → grant exactly once
  function rewardGranted(){
    var f = pendingReward; pendingReward = null;
    if(f){ try{ f(); }catch(e){} }
  }
  function rewardedHidden(){
    showing = false;
    pendingReward = null;               // closed without reward = skipped, no grant
    try{ cfg.onHide(); }catch(e){}
    try{ cfg.bridge.loadRewarded(); }catch(e){}
  }

  // ── map hooks ──
  function onScaleChange(){                       // micro-action: only eligible every Nth change
    if(cfg.placements.scaleChange === false) return;
    scaleCount++;
    if(scaleCount >= cfg.SCALE_TRIGGER_N){ scaleCount = 0; showInterstitial('scale-changes'); }
  }
  function onFeatureOpen(name){ cfg.log('feature open', name); }   // prefer firing on CLOSE
  function onFeatureClose(name){ if(cfg.placements.featureClose === false) return false; return showInterstitial('feature-close:' + name); }
  function onExport(kind){ if(cfg.placements.export === false) return false; return showInterstitial('export:' + kind); }
  function onGradeDismissed(){ if(cfg.placements.gradeComplete === false) return false; return showInterstitial('grade-complete'); }  // the primary spot

  return { configure, setUnlocked, showInterstitial, adHidden, showRewarded, rewardedHidden, rewardGranted,
           pauseAV: function(){ try{ cfg.onShow(); }catch(e){} },   // sim bridge pauses audio like a real ad
           resumeAV: function(){ try{ cfg.onHide(); }catch(e){} },
           onScaleChange, onFeatureOpen, onFeatureClose, onExport, onGradeDismissed };
})();

// ── SIM BRIDGE (v461) — active ONLY when window.NativeAds is absent (Brave / file:// / dev).
//    Shows fake TEST ADS so the whole pipeline — gating, pacing, rewards, ledger — is testable
//    without the store build. The Capacitor build defines window.NativeAds and never sees this.
//    NATIVE TODO: the plugin's didRewardUser callback must call AdManager.rewardGranted().
function makeSimBridge(){
  function ov(html){
    var d=document.createElement('div');
    d.style.cssText='position:fixed;inset:0;z-index:100060;background:#0b0b10f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:Bangers,cursive;letter-spacing:1px;text-align:center;';
    d.innerHTML=html; document.body.appendChild(d); return d;
  }
  return {
    isReady: function(){ return true; },
    load: function(){}, loadRewarded: function(){},
    isRewardedReady: function(){ return true; },
    show: function(){
      AdManager.pauseAV();
      var d=ov('<div style="color:#ffd54a;font-size:1.5em;">TEST AD · INTERSTITIAL</div>'
        +'<div style="color:#889;font-size:0.8em;">(simulated — the native build shows a real ad here)</div>'
        +'<button id="simSkip" disabled style="margin-top:10px;padding:10px 26px;border:1px solid #555;border-radius:8px;background:#1a1a22;color:#777;font-family:inherit;letter-spacing:1px;">SKIP</button>');
      var b=d.querySelector('#simSkip'), closed=false;
      setTimeout(function(){ b.disabled=false; b.style.color='#fff'; b.style.borderColor='#ffd54a'; },1200);
      function close(){ if(closed) return; closed=true; try{ d.remove(); }catch(e){} try{ AdManager.adHidden(); }catch(e){} }
      b.onclick=function(){ if(!b.disabled) close(); };
      setTimeout(close,3200);
    },
    showRewarded: function(reason){
      AdManager.pauseAV();
      var left=5;
      var d=ov('<div style="color:#a5f3a5;font-size:1.4em;">TEST AD · REWARDED</div>'
        +'<div id="simCnt" style="color:#fff;font-size:2.2em;">5</div>'
        +'<div style="color:#889;font-size:0.78em;">watch to the end to claim the reward</div>'
        +'<div style="display:flex;gap:12px;margin-top:8px;">'
          +'<button id="simClaim" disabled style="padding:10px 26px;border:none;border-radius:8px;background:#2a2a33;color:#777;font-family:inherit;letter-spacing:1px;">CLAIM</button>'
          +'<button id="simX" style="padding:10px 18px;border:1px solid #555;border-radius:8px;background:#1a1a22;color:#bbb;font-family:inherit;">✕</button>'
        +'</div>');
      var cnt=d.querySelector('#simCnt'), cl=d.querySelector('#simClaim'), done=false;
      var t=setInterval(function(){ left--; cnt.textContent=left>0?left:'✓'; if(left<=0){ clearInterval(t); cl.disabled=false; cl.style.background='#00cc66'; cl.style.color='#000'; } },1000);
      function end(grant){ if(done) return; done=true; clearInterval(t); try{ d.remove(); }catch(e){}
        if(grant){ try{ AdManager.rewardGranted(); }catch(e){} }
        try{ AdManager.rewardedHidden(); }catch(e){} }
      cl.onclick=function(){ if(!cl.disabled) end(true); };
      d.querySelector('#simX').onclick=function(){ end(false); };
      return true;
    }
  };
}

// Wire audio + native bridge (bridge stays no-op until the Capacitor plugin defines window.NativeAds).
AdManager.configure({
  bridge: (typeof window !== 'undefined' && window.NativeAds) ? window.NativeAds : makeSimBridge(),   // v461: sim ads in web builds
  onShow: function(){
    try{ var ac = window.getAC && window.getAC(); if(ac && ac.suspend) ac.suspend(); }catch(e){}   // kill synth/sampler/reverb
    try{ if(typeof metStop === 'function') metStop(); }catch(e){}                                    // halt metronome scheduler
    try{ window.BackingTracks && window.BackingTracks.stopTrack && window.BackingTracks.stopTrack(); }catch(e){}
  },
  onHide: function(){ try{ var ac = window.getAC && window.getAC(); if(ac && ac.resume) ac.resume(); }catch(e){} },  // resume; user re-starts play
  log: function(){ try{ console.log.apply(console, ['[ADS]'].concat([].slice.call(arguments))); }catch(e){} },
});

// ── REMOTE CONFIG (GitHub) — overrides the baked defaults on launch, so frequency and the
//   global killswitch are changeable without a store resubmit. Fails SAFE: any fetch error
//   (offline, file:// test build, GitHub down) keeps the conservative baked defaults. Public
//   file — tuning only; no SDK keys / payouts here. Compliance rules are NOT togglable here.
(function(){
  var CONFIG_URL = 'https://raw.githubusercontent.com/trickishxsham/samplepacks/main/ads.json';
  function loadAdConfig(){
    try{
      fetch(CONFIG_URL + '?t=' + Date.now(), { cache:'no-store' })   // raw + cache-bust → minutes-fresh, good enough for a killswitch
        .then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(function(c){
          if(!c) return;
          if(c.enabled === false){ AdManager.setUnlocked(true); console.log('[ADS] remote killswitch — ads OFF'); return; }
          var i = c.interstitial || {};
          AdManager.configure({
            MIN_GAP_MS:        (typeof i.minGapMs       === 'number') ? i.minGapMs       : undefined,
            SESSION_MAX:       (typeof i.sessionMax     === 'number') ? i.sessionMax     : undefined,
            FIRST_AD_DELAY_MS: (typeof i.firstAdDelayMs === 'number') ? i.firstAdDelayMs : undefined,
            SHOW_PROB:         (typeof i.showProb       === 'number') ? i.showProb       : undefined,
            placements:        c.placements || undefined,
            rewardedEnabled:   c.rewarded ? (c.rewarded.enabled !== false) : undefined,
          });
          try{ window.AdEngine && AdEngine.applyRemote(c); }catch(e){}
          console.log('[ADS] remote config v' + (c.version || '?') + ' applied');
        })
        .catch(function(){ /* keep baked defaults */ });
    }catch(e){}
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadAdConfig);
  else loadAdConfig();
})();


// ── AD ENGINE (v461) — the revenue layer on top of the AdManager gatekeeper ──────────────
//   • per-day impression ledger + rough $ estimator (REAL numbers live in the MAX dashboard)
//   • dead-zone: interstitials wait ~0.9s after the last touch (accidental-click protection —
//     protects the AdMob/MAX account from invalid-traffic flags)
//   • rewarded router: the reward is granted by the ad (native didRewardUser → rewardGranted)
//   • AD-FREE HOUR: watch one rewarded → banner hidden + temp EXPERT for 60 min, capped per
//     day, all knobs remote-tunable via ads.json. Interstitials/rewarded keep running.
window.AdEngine = (function(){
  var E = { deadZoneMs:900, adfree:{ enabled:true, minutes:60, dailyCap:2 },
            rewGems:{ enabled:true, amount:25, dailyCap:3 }, bonusRoll:{ enabled:true, dailyCap:5 },
            bannerRefreshSec:30, ecpm:{ inter:5, rewarded:9, banner:0.8 } };
  var _lastTouch = 0, _tickT = null;
  try{ document.addEventListener('pointerdown', function(){ _lastTouch = Date.now(); }, true); }catch(e){}

  function _day(){ var d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
  function _led(){ try{ var j=JSON.parse(localStorage.getItem('improvs2_ads_ledger')||'null'); if(!j||j.d!==_day()) j={d:_day(),c:{}}; return j; }catch(e){ return {d:_day(),c:{}}; } }
  function bump(tag){ try{ var j=_led(); j.c[tag]=(j.c[tag]||0)+1; localStorage.setItem('improvs2_ads_ledger', JSON.stringify(j)); }catch(e){} }
  function stats(){
    var j=_led(), ints=0, rews=0, k;
    for(k in j.c){ if(k.indexOf('int:')===0) ints+=j.c[k]; else if(k.indexOf('rew:')===0) rews+=j.c[k]; }
    var bmin=j.c['banner_min']||0;
    var eB=+(bmin*(60/Math.max(5,E.bannerRefreshSec))*E.ecpm.banner/1000).toFixed(3);
    var eI=+(ints*E.ecpm.inter/1000).toFixed(3);
    var eR=+(rews*E.ecpm.rewarded/1000).toFixed(3);
    return { day:j.d, counts:j.c, interstitials:ints, rewarded:rews, bannerMin:bmin,
             estBanner:eB, estInt:eI, estRew:eR, estUSD:+(eB+eI+eR).toFixed(3) };
  }

  // interstitial with dead-zone — AdManager re-checks every gate (grace/gap/cap/prob) at fire time
  function interstitial(tag){
    var wait = Math.max(0, E.deadZoneMs - (Date.now()-_lastTouch));
    setTimeout(function(){ try{ AdManager.showInterstitial(tag); }catch(e){} }, wait+30);
  }
  function rewarded(tag, opts){
    opts = opts||{};
    var ok=false;
    try{ ok = AdManager.showRewarded(tag, opts.onReward); }catch(e){}
    if(!ok && opts.onUnavailable){ try{ opts.onUnavailable(); }catch(e){} }
    return ok;
  }

  // ── ad-free hour ──
  function adFreeUntil(){ try{ return parseInt(localStorage.getItem('improvs2_adfree_until')||'0',10)||0; }catch(e){ return 0; } }
  function adFreeActive(){ return Date.now() < adFreeUntil(); }
  function redeemsLeft(){ return Math.max(0, (E.adfree.dailyCap|0) - (_led().c['adfree_redeem']||0)); }
  function _fmt(ms){ var t=Math.max(0,Math.round(ms/1000)), m=Math.floor(t/60); t-=m*60; return m+':'+(t<10?'0':'')+t; }
  function _tick(){
    var p=document.getElementById('adfreePill'); if(!p) return;
    if(adFreeActive()){ p.textContent='🎬 '+_fmt(adFreeUntil()-Date.now())+' AD-FREE'; }
    else { clearInterval(_tickT); _tickT=null; try{ applyEntitlements(); }catch(e){} }
  }
  function _startTick(){ if(_tickT) return; _tickT=setInterval(_tick,1000); _tick(); }
  function redeemAdFreeHour(done){
    if(!E.adfree.enabled || !redeemsLeft()){ if(done) done(false); return; }
    rewarded('adfree-hour', {
      onReward: function(){
        var until = Math.max(Date.now(), adFreeUntil()) + E.adfree.minutes*60000;
        try{ localStorage.setItem('improvs2_adfree_until', String(until)); }catch(e){}
        bump('adfree_redeem'); _startTick();
        try{ applyEntitlements(); }catch(e){}
        try{ window.flashAurora && flashAurora('#ffd54a', 0.6, 1800); }catch(e){}
        if(done) done(true);
      },
      onUnavailable: function(){ if(done) done(false); }
    });
  }
  if(adFreeActive()) _startTick();

  // ── rewarded GEM top-up: the FREE path, listed above the IAP tiers in the gem store ──
  function rewGems(){ return { enabled:!!E.rewGems.enabled, amount:E.rewGems.amount|0, cap:E.rewGems.dailyCap|0,
                               left: Math.max(0,(E.rewGems.dailyCap|0)-(_led().c['rewgems_redeem']||0)) }; }
  function redeemRewGems(done){
    var g=rewGems();
    if(!g.enabled || !g.left){ if(done) done(false); return; }
    rewarded('gems-topup', {
      onReward: function(){
        try{ window.Gems && Gems.add(g.amount); }catch(e){}
        bump('rewgems_redeem');
        try{ window.flashAurora && flashAurora('#22d3ee',0.6,1500); }catch(e){}
        if(done) done(true);
      },
      onUnavailable: function(){ if(done) done(false); }
    });
  }
  // ── bonus loot roll: opt-in rewarded that REPLACES that cycle's collect interstitial ──
  function bonusRollsLeft(){ return E.bonusRoll.enabled ? Math.max(0,(E.bonusRoll.dailyCap|0)-(_led().c['bonusroll_redeem']||0)) : 0; }
  // ── banner visibility minutes — honest banner-vs-rewarded comparison in the stats panel ──
  try{ setInterval(function(){
    try{
      var b=document.getElementById('adBannerTop');
      if(b && b.style.display!=='none' && document.visibilityState==='visible') bump('banner_min');
    }catch(e){}
  }, 60000); }catch(e){}

  // ── remove-ads chooser (opens from the banner tap) ──
  function showRemoveAdsChooser(opts){
    opts=opts||{};
    var old=document.getElementById('adChooser'); if(old) old.remove();
    var left=redeemsLeft();
    var can = E.adfree.enabled && left>0 && !(window.proUnlocked && proUnlocked());
    var d=document.createElement('div'); d.id='adChooser';
    d.style.cssText='position:fixed;inset:0;z-index:100040;background:#000000cc;display:flex;align-items:center;justify-content:center;padding:24px;';
    d.innerHTML='<div style="background:#14121c;border:1px solid #a855f7;border-radius:14px;padding:20px 18px;max-width:340px;width:100%;text-align:center;font-family:Bangers,cursive;letter-spacing:1px;">'
      +'<div style="color:#ffd54a;font-size:1.25em;margin-bottom:12px;">REMOVE ADS</div>'
      +'<button id="acWatch" '+(can?'':'disabled')+' style="width:100%;padding:12px;border:none;border-radius:9px;background:'+(can?'linear-gradient(135deg,#00cc66,#118844)':'#22222a')+';color:'+(can?'#00130a':'#666')+';font-family:inherit;letter-spacing:1px;font-size:0.95em;margin-bottom:10px;">🎬 WATCH AD · 1 HR AD-FREE + EXPERT<br><span style="font-size:0.7em;opacity:0.85;">'+(can?(left+'/'+E.adfree.dailyCap+' left today'):'back tomorrow')+'</span></button>'
      +'<button id="acPro" style="width:100%;padding:12px;border:none;border-radius:9px;background:linear-gradient(135deg,#7c3aed,#4c1d95);color:#fff;font-family:inherit;letter-spacing:1px;font-size:0.95em;margin-bottom:10px;">⭐ PRO FOREVER · $9.99<br><span style="font-size:0.7em;opacity:0.85;">never see an ad again + Expert included</span></button>'
      +'<button id="acNo" style="padding:8px 20px;border:1px solid #444;border-radius:8px;background:transparent;color:#889;font-family:inherit;font-size:0.8em;">NOT NOW</button>'
      +'</div>';
    document.body.appendChild(d);
    function close(){ try{ d.remove(); }catch(e){} }
    d.addEventListener('click', function(e){ if(e.target===d) close(); });
    d.querySelector('#acNo').onclick=close;
    d.querySelector('#acPro').onclick=function(){ close(); if(opts.onPro){ try{ opts.onPro(); }catch(e){} } };
    var w=d.querySelector('#acWatch');
    if(can) w.onclick=function(){ close(); redeemAdFreeHour(); };
  }

  // remote knobs (ads.json): { deadZoneMs, adfree:{enabled,minutes,dailyCap}, ecpm:{inter,rewarded} }
  function applyRemote(c){
    if(!c) return;
    try{
      if(typeof c.deadZoneMs==='number') E.deadZoneMs=c.deadZoneMs;
      if(c.adfree){ var a=c.adfree;
        if(typeof a.enabled==='boolean') E.adfree.enabled=a.enabled;
        if(typeof a.minutes==='number')  E.adfree.minutes=a.minutes;
        if(typeof a.dailyCap==='number') E.adfree.dailyCap=a.dailyCap; }
      if(c.ecpm){ if(typeof c.ecpm.inter==='number') E.ecpm.inter=c.ecpm.inter;
                  if(typeof c.ecpm.rewarded==='number') E.ecpm.rewarded=c.ecpm.rewarded;
                  if(typeof c.ecpm.banner==='number') E.ecpm.banner=c.ecpm.banner; }
      if(c.rewGems){ var g=c.rewGems;
        if(typeof g.enabled==='boolean') E.rewGems.enabled=g.enabled;
        if(typeof g.amount==='number')   E.rewGems.amount=g.amount;
        if(typeof g.dailyCap==='number') E.rewGems.dailyCap=g.dailyCap; }
      if(c.bonusRoll){ var b2=c.bonusRoll;
        if(typeof b2.enabled==='boolean') E.bonusRoll.enabled=b2.enabled;
        if(typeof b2.dailyCap==='number') E.bonusRoll.dailyCap=b2.dailyCap; }
      if(typeof c.bannerRefreshSec==='number') E.bannerRefreshSec=c.bannerRefreshSec;
    }catch(e){}
  }

  // count every impression the gatekeeper actually lets through
  try{ AdManager.configure({ onImpression: function(kind,reason){ bump((kind==='rewarded'?'rew:':'int:')+reason); } }); }catch(e){}

  return { interstitial, rewarded, adFreeActive, redeemsLeft, redeemAdFreeHour,
           rewGems, redeemRewGems, bonusRollsLeft,
           showRemoveAdsChooser, stats, bump, applyRemote, _startTick };
})();




try{ window.AdManager=AdManager; }catch(e){}
window.registerModule('ads', {
  version: MODULE_VERSION,
  isStub: false
});
console.log('[modules] ads v' + MODULE_VERSION);
})();
