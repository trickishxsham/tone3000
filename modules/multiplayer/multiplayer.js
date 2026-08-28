// modules/multiplayer/multiplayer.js
// version: 4.9.8.860
// PeerJS LIVE JAM / VS / Tourney + MQTT presence (MqttJam)
// Extracted from app-860 lineage. Requires peerjs + mqtt scripts already on page.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.861-lite42-combined';

// Complements PeerJS seat-id races + dreamlo with a real-time pub/sub channel.
// Uses a public MQTT broker over WebSockets. Retain messages give us durable
// "who is host of this lobby right now" state without a custom game server.
//
// Topics (all under improvs2/):
//   lobby/{code}/host     retain  → {nonce, nick, ts, seat}
//   lobby/{code}/presence         → {nick, seat, ts, isHost}
//   lobby/{code}/count    retain  → {n, sealed, ts}
//   lobby/{code}/chat             → {from, text, ts}
//   lobby/{code}/score            → score payloads
(function(){
  if(typeof mqtt === 'undefined'){
    console.warn('[MqttJam] mqtt.js not loaded — presence layer disabled');
    window.MqttJam = { ready:function(){return false;}, claimHost:function(){return Promise.resolve(null);}, publishPresence:function(){}, getLobbyPresence:function(){return [];}, joinLobby:function(){return Promise.resolve();}, publishCount:function(){}, leaveLobby:function(){}, getLobbyCount:function(){return 0;} };
    return;
  }

  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  var client = null;
  var connected = false;
  var myClientId = 'improvs2-' + (Math.random().toString(36).slice(2,10));
  var presenceMap = {};
  var hostClaims = {};
  var countCache = {};
  var listeners = [];

  function topic(code, kind){ return 'improvs2/lobby/' + String(code||'').toUpperCase() + '/' + kind; }

  function connect(){
    if(client && connected) return Promise.resolve(client);
    return new Promise(function(resolve, reject){
      var bi = 0;
      function tryNext(){
        if(bi >= BROKERS.length){ reject(new Error('all MQTT brokers failed')); return; }
        var url = BROKERS[bi++];
        try{
          if(client){ try{ client.end(true); }catch(e){} }
          client = mqtt.connect(url, {
            clientId: myClientId,
            clean: true,
            reconnectPeriod: 4000,
            connectTimeout: 8000,
            keepalive: 30
          });
          var settled = false;
          var to = setTimeout(function(){
            if(settled) return;
            settled = true;
            try{ client.end(true); }catch(e){}
            tryNext();
          }, 9000);
          client.on('connect', function(){
            if(settled) return;
            settled = true; clearTimeout(to);
            connected = true;
            console.log('[MqttJam] connected via', url);
            Object.keys(presenceMap).forEach(function(c){ subLobby(c); });
            resolve(client);
          });
          client.on('error', function(err){
            console.warn('[MqttJam] error', err && err.message);
            if(!settled){ settled = true; clearTimeout(to); tryNext(); }
          });
          client.on('close', function(){ connected = false; });
          client.on('message', onMessage);
        }catch(e){ tryNext(); }
      }
      tryNext();
    });
  }

  function onMessage(topicStr, buf){
    try{
      var parts = topicStr.split('/');
      if(parts.length < 4 || parts[0] !== 'improvs2' || parts[1] !== 'lobby') return;
      var code = parts[2];
      var kind = parts[3];
      var msg = null;
      try{ msg = JSON.parse(buf.toString()); }catch(e){ return; }
      if(kind === 'presence'){
        presenceMap[code] = presenceMap[code] || {};
        var key = (msg.seat || msg.nick || 'anon');
        if(msg.leave){ delete presenceMap[code][key]; }
        else { presenceMap[code][key] = msg; }
        var now = Date.now();
        Object.keys(presenceMap[code]).forEach(function(k){
          if((now - (presenceMap[code][k].ts||0)) > 90000) delete presenceMap[code][k];
        });
      } else if(kind === 'host'){
        hostClaims[code] = hostClaims[code] || [];
        if(msg && msg.nonce){
          hostClaims[code].push(msg);
          if(hostClaims[code].length > 30) hostClaims[code] = hostClaims[code].slice(-30);
        }
      } else if(kind === 'count'){
        countCache[code] = msg;
      }
      listeners.forEach(function(fn){ try{ fn(kind, code, msg); }catch(e){} });
    }catch(e){}
  }

  function subLobby(code){
    if(!client || !connected) return;
    ['presence','host','count','chat','score'].forEach(function(k){
      try{ client.subscribe(topic(code, k), {qos:0}); }catch(e){}
    });
  }

  function pub(code, kind, payload, retain){
    if(!client || !connected) return;
    try{
      client.publish(topic(code, kind), JSON.stringify(payload), {qos:0, retain:!!retain});
    }catch(e){}
  }

  function electHost(code){
    var list = (hostClaims[code] || []).slice();
    if(!list.length) return null;
    list.sort(function(a,b){ return (a.ts|0) - (b.ts|0); });
    return list[0];
  }

  window.MqttJam = {
    ready: function(){ return connected; },
    clientId: function(){ return myClientId; },
    connect: connect,
    on: function(fn){ if(typeof fn==='function') listeners.push(fn); },
    joinLobby: function(code){
      return connect().then(function(){
        subLobby(code);
        presenceMap[code] = presenceMap[code] || {};
      });
    },
    leaveLobby: function(code, seat, nick){
      pub(code, 'presence', {nick:nick||'', seat:seat||'', ts:Date.now(), leave:true}, false);
    },
    publishPresence: function(code, payload){
      if(!payload) return;
      payload.ts = Date.now();
      pub(code, 'presence', payload, false);
    },
    publishCount: function(code, n, sealed){
      pub(code, 'count', {n:n|0, sealed:!!sealed, ts:Date.now()}, true);
    },
    getLobbyPresence: function(code){
      var m = presenceMap[code] || {};
      return Object.keys(m).map(function(k){ return m[k]; });
    },
    getLobbyCount: function(code){
      var c = countCache[code];
      if(c) return c.n|0;
      return Object.keys(presenceMap[code]||{}).length;
    },
    claimHost: function(code, nonce, nick, seat){
      return connect().then(function(){
        subLobby(code);
        var claim = {nonce:nonce, nick:nick||'', seat:seat||'', ts:Date.now(), cid:myClientId};
        hostClaims[code] = hostClaims[code] || [];
        hostClaims[code].push(claim);
        pub(code, 'host', claim, true);
        return new Promise(function(resolve){
          setTimeout(function(){
            pub(code, 'presence', {nick:nick||'', seat:seat||'', ts:Date.now(), isHost:true, ping:true}, false);
            setTimeout(function(){
              var winner = electHost(code);
              var won = !!(winner && winner.nonce === nonce);
              resolve({won:won, claim:winner, my:claim});
            }, 1200);
          }, 1800);
        });
      });
    },
    readHost: function(code){
      return connect().then(function(){
        subLobby(code);
        return new Promise(function(resolve){
          setTimeout(function(){ resolve(electHost(code)); }, 900);
        });
      });
    },
    sendChat: function(code, from, text){
      pub(code, 'chat', {from:from||'', text:String(text||'').slice(0,280), ts:Date.now()}, false);
    },
    sendScore: function(code, scoreObj){
      pub(code, 'score', scoreObj, false);
    }
  };

  setTimeout(function(){ connect().catch(function(){}); }, 2500);
})();

(function(){
  let peer=null, conn=null, isHost=false, roomCode=null;
  let myName='', partnerName='', partnerReady=false;
  let pendingProposal=null;   // {trackId, title, bpm} sent BY US, awaiting their vote
  let noteSeq=0;               // v744: monotonic id so noteOn/noteOff pairs match across the wire
  const remoteVoices={};       // id -> makeVoice() result for partner notes still ringing
  let _lastBendSent={};        // id -> {semis, t} throttle so bend floods don't kill PeerJS
  // v759: modes + public 4/8 lobbies (PeerJS P2P, dreamlo as tiny lobby board — no game server)
  let jamMode='jam', noteRelay=true, isSpectator=false;
  let vsMyScore=null, vsTheirScore=null;
  let tourney={size:8, players:[], bracket:[], round:0, matchIdx:0, active:false, replays:{}};
  let publicLobbies={4:{code:'4PT1', count:0}, 8:{code:'8PT1', count:0}, jam:{code:'JAM1', count:0}, vs:{code:'VS1', count:0}};
  let publicKind=null;
  const tourneyConns={};
  // ── v845: BOT FILL + ELO ──────────────────────────────────────────────
  // 20-name pool (user-chosen). Host fills empty 4p/8p seats so lobbies don't stall.
  // Bot scores land slightly under the best real player. Elo is pairwise / versus only
  // among real humans; bots never earn or spend rating.
  const BOT_NAME_POOL=['Mark','Miah','Aido','Will','Dezy','Shan','Trev','Jonny','Ray','Dennis','Ryan','Tom','Justin','Ciaran','Cian','Lucy','Lara','Denise','Aine','Katie'];
  var tourneyBots={}; // name -> true (session-local; not sent as PeerJS peers)
  var _botFillTimer=null;
  function isBotName(n){
    try{ return !!(tourneyBots && tourneyBots[String(n||'')]); }catch(e){ return false; }
  }
  function shuffleArr(a){
    var b=a.slice();
    for(var i=b.length-1;i>0;i--){ var j=(Math.random()*(i+1))|0; var t=b[i]; b[i]=b[j]; b[j]=t; }
    return b;
  }
  function realPlayerCount(){
    try{
      var n=0;
      (tourney.players||[]).forEach(function(p){ if(p && !isBotName(p)) n++; });
      return n;
    }catch(e){ return 0; }
  }
  function pickBotNames(need){
    var used={};
    (tourney.players||[]).forEach(function(p){ used[baseNick(p).toLowerCase()]=1; });
    var pool=shuffleArr(BOT_NAME_POOL).filter(function(n){ return !used[n.toLowerCase()]; });
    return pool.slice(0, Math.max(0, need|0));
  }
  // v861-lite33: never exceed lobby size (bots were pushing 5/4)
  function rosterCap(){
    var c=parseInt(tourney.size||publicKind||8, 10);
    if(!(c>0 && c<=16)) c=8;
    return c;
  }
  function clampRosterToCap(){
    try{
      var cap=rosterCap();
      tourney.players=uniqRoster(tourney.players||[], myName);
      var guard=0;
      while(tourney.players.length>cap && guard++<32){
        var bi=-1;
        for(var i=tourney.players.length-1;i>=0;i--){
          if(isBotName(tourney.players[i])){ bi=i; break; }
        }
        if(bi>=0){
          var gone=tourney.players.splice(bi,1)[0];
          try{ delete tourneyBots[gone]; delete tourneyBots[baseNick(gone)]; }catch(e){}
        } else break;
      }
      if(tourney.players.length>cap) tourney.players=tourney.players.slice(0,cap);
    }catch(e){}
  }
  function fillBotsIfNeeded(force){
    try{
      if(!isHost) return 0;
      if(!(publicKind===4||publicKind===8||jamMode==='tournament')) return 0;
      clampRosterToCap();
      var cap=rosterCap();
      var cur=(tourney.players||[]).length;
      var need=cap-cur;
      if(need<=0) return 0;
      if(!force && realPlayerCount()<1) return 0;
      var names=pickBotNames(need);
      if(!names.length) return 0;
      var added=[];
      names.forEach(function(n){
        if((tourney.players||[]).length>=cap) return;
        tourneyBots[n]=true;
        tourney.players.push(n);
        added.push(n);
        clampRosterToCap();
      });
      if(!added.length) return 0;
      clampRosterToCap();
      var nNow=(tourney.players||[]).length;
      try{ renderBracket(); updateLobby(); }catch(e){}
      try{ jamSendAll({type:'tourneyLobby', players:tourney.players, size:tourney.size, bots:Object.keys(tourneyBots)}); }catch(e){}
      try{ applyLobbyCount(publicKind||tourney.size, roomCode, Math.min(nNow,cap), nNow>=cap); }catch(e){}
      try{ if(publicKind && roomCode) publishLobby(publicKind||tourney.size, roomCode, Math.min(nNow,cap), nNow>=cap); }catch(e){}
      setStatus('Filled '+added.length+' bot seat(s): '+added.join(', ')+' ('+Math.min(nNow,cap)+'/'+cap+')');
      window.jamHud&&window.jamHud('bots joined: '+added.join(', '));
      try{ autoStartIfFull(); }catch(e){}
      return added.length;
    }catch(e){ return 0; }
  }
  function scheduleBotFill(ms){
    try{ if(_botFillTimer) clearTimeout(_botFillTimer); }catch(e){}
    _botFillTimer=setTimeout(function(){
      _botFillTimer=null;
      try{
        clampRosterToCap();
        if((tourney.players||[]).length>=rosterCap()) return;
        fillBotsIfNeeded(false);
      }catch(e){}
    }, ms||28000);
  }
  function gradeFromScore(s){
    s=s|0;
    if(s>=90) return 'S';
    if(s>=80) return 'A';
    if(s>=70) return 'B';
    if(s>=60) return 'C';
    if(s>=50) return 'D';
    return 'F';
  }
  // Inject bot scores slightly under the best real player so human wins stay earned.
  function injectBotScores(){
    try{
      if(!isHost) return;
      if(!window.__jamScores) window.__jamScores={};
      var scores=window.__jamScores;
      var bestReal=0, hasReal=false;
      Object.keys(scores).forEach(function(k){
        if(isBotName(k)) return;
        hasReal=true;
        var sc=scores[k].score|0;
        if(sc>bestReal) bestReal=sc;
      });
      if(!hasReal) bestReal=58;
      (tourney.players||[]).forEach(function(p){
        if(!isBotName(p)) return;
        if(scores[p]) return; // already submitted
        var lag=4+((Math.random()*11)|0); // 4–14 under best
        var sc=Math.max(38, Math.min(72, bestReal-lag));
        scores[p]={score:sc, grade:gradeFromScore(sc), nick:p, rep:'EMPTY', trackId:null, bot:true};
      });
    }catch(e){}
  }
  // ── Elo (local, per base nick) ──
  function eloLoad(){
    try{ return JSON.parse(localStorage.getItem('improvs2_elo')||'{}')||{}; }catch(e){ return {}; }
  }
  function eloSave(map){
    try{ localStorage.setItem('improvs2_elo', JSON.stringify(map||{})); }catch(e){}
  }
  function getElo(nick){
    var m=eloLoad();
    var k=baseNick(nick).toLowerCase();
    var v=m[k];
    return (typeof v==='number' && isFinite(v)) ? v : 1000;
  }
  function setElo(nick, rating){
    var m=eloLoad();
    m[baseNick(nick).toLowerCase()]=Math.max(600, Math.round(rating));
    eloSave(m);
  }
  function eloExpected(rA, rB){
    return 1/(1+Math.pow(10,(rB-rA)/400));
  }
  function eloUpdatePair(nickA, nickB, scoreA /*1/0.5/0*/, K){
    if(isBotName(nickA)||isBotName(nickB)) return;
    K=K||24;
    var rA=getElo(nickA), rB=getElo(nickB);
    var eA=eloExpected(rA, rB);
    setElo(nickA, rA+K*(scoreA-eA));
    setElo(nickB, rB+K*((1-scoreA)-(1-eA)));
  }
  function eloApplyVersus(myNick, theirNick, myScore, theirScore){
    try{
      if(isBotName(myNick)||isBotName(theirNick)) return;
      var s=0.5;
      if((myScore|0)>(theirScore|0)) s=1;
      else if((myScore|0)<(theirScore|0)) s=0;
      eloUpdatePair(myNick, theirNick, s, 24);
    }catch(e){}
  }
  function eloApplyLobbyScores(scoreMap){
    try{
      var keys=Object.keys(scoreMap||{}).filter(function(k){ return !isBotName(k); });
      for(var i=0;i<keys.length;i++){
        for(var j=i+1;j<keys.length;j++){
          var a=scoreMap[keys[i]], b=scoreMap[keys[j]];
          var s=0.5;
          if((a.score|0)>(b.score|0)) s=1;
          else if((a.score|0)<(b.score|0)) s=0;
          eloUpdatePair(keys[i], keys[j], s, 16);
        }
      }
    }catch(e){}
  }
  // ── end v845 bot + Elo ────────────────────────────────────────────────

  function genLobbyCode(prefix){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s=prefix||''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)];
    return s;
  }
  function copyText(str, btn){
    if(!str) return;
    function ok(){ if(btn){ const t=btn.textContent; btn.textContent='✓'; setTimeout(function(){ btn.textContent=t; }, 1000); } setStatus('Copied '+str); }
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(str).then(ok).catch(function(){
        const ta=document.createElement('textarea'); ta.value=str; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');ok();}catch(e){} ta.remove();
      });
      else { const ta=document.createElement('textarea'); ta.value=str; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');ok();}catch(e){} ta.remove(); }
    }catch(e){ setStatus(str); }
  }
  function setJamMode(m){
    jamMode=m; noteRelay=(m==='jam');
    document.querySelectorAll('.jam-mode-btn').forEach(function(b){
      const on=b.dataset.jmode===m;
      b.style.border=on?'1px solid #ffd700':'1px solid #444';
      b.style.background=on?'#ffd70022':'transparent';
      b.style.color=on?'#ffd700':'#889';
    });
    const help=document.getElementById('jamModeHelp');
    const blurb=document.getElementById('jamModeBlurb');
    const tsz=document.getElementById('jamTourneySize');
    const vs=document.getElementById('jamVsBox');
    const br=document.getElementById('jamBracketBox');
    if(help){
      help.textContent=m==='jam'?'Trade phrases with note relay.'
        :m==='versus'?'1v1 duel — no notes shared, highest grade wins.'
        :'Public 4/8 lobbies. Fill → auto-start. Spectate with the code. New code when full.';
    }
    if(blurb){
      blurb.textContent=m==='jam'?'Propose a track — notes land one turn later.'
        :m==='versus'?'Propose a track, both record, submit scores. Notes stay local.'
        :'Join a public lobby below (or share a private code). Versus matches inside the bracket.';
    }
    if(tsz) tsz.style.display=m==='tournament'?'block':'none';
    if(vs) vs.style.display=(m==='versus'||m==='tournament')?'block':'none';
    if(br) br.style.display=m==='tournament'?'block':'none';
    const pj=document.getElementById('jamPublicJam');
    const pv=document.getElementById('jamPublicVs');
    if(pj) pj.style.display=m==='jam'?'block':'none';
    if(pv) pv.style.display=m==='versus'?'block':'none';
    try{ refreshPublicLobbies(); }catch(e){}
    try{ if(conn&&conn.open) conn.send({type:'mode', mode:m}); }catch(e){}
  }
  function livePublicCount(kind){
    // v844: any participant in the room can overlay roster truth on OPEN LOBBIES
    //   (was host-only → non-hosts stayed stuck at 0/8 while connected 7/8)
    try{
      if(publicKind!==kind || !roomCode) return null;
      if(kind===4||kind===8 || jamMode==='tournament'){
        try{ return Math.max(1, currentLobbyPlayers()|0); }catch(e){}
        return (tourney.players&&tourney.players.length)|0;
      }
      // jam / vs 1v1
      return partnerReady ? 2 : 1;
    }catch(e){ return null; }
  }
  function renderPublicLobbies(){
    // v778: every public lobby shows live player count (jam, vs, 4, 8).
    // Fixed codes always visible; host overlays true in-room count when applicable.
    [4,8].forEach(function(n){
      const L=publicLobbies[n]||{code:'',count:0};
      const live=livePublicCount(n);
      // v842: while we're inside this lobby, UI count always follows roster (never 0/4 flash)
      if(live!=null && roomCode && (L.code===roomCode || publicKind===n)){
        L.count=live; L.sealed=live>=n; L.code=roomCode;
      }
      const c=document.getElementById('lobby'+n+'Code');
      const k=document.getElementById('lobby'+n+'Count');
      const shown=L.code || (slotsFor(n)||[])[0] || (n+'PT1');
      if(c) c.textContent=shown;
      if(k) k.textContent=(L.count|0)+'/'+n+(L.sealed?' · LIVE':'');
    });
    [['jam','Jam',2],['vs','Vs',2]].forEach(function(row){
      const key=row[0], label=row[1], cap=row[2];
      const L=publicLobbies[key]||{code:'',count:0};
      const live=livePublicCount(key);
      // only overlay host count when open listing still points at OUR room and not full
      if(live!=null && L.code===roomCode && live<cap){ L.count=live; L.sealed=false; }
      const c=document.getElementById('lobby'+label+'Code');
      const k=document.getElementById('lobby'+label+'Count');
      const shown=L.code||(slotsFor(key)||[])[0];
      if(c) c.textContent=shown||'—';
      if(k) k.textContent=(L.count|0)+'/'+cap+(L.sealed?' · FULL':'');
    });
  }
  // Publish open lobby to dreamlo (tiny registry — same board as scores, near-zero cost)
  function publishLobby(size, code, count, sealed){
    // v790: full room must not pin OPEN LOBBY on the sealed code — listing advances to next
    const cap=lobbyCap(size);
    const full=!!sealed || ((count|0)>=cap);
    const cur=publicLobbies[size];
    if(full && cur && cur.code && cur.code!==code){
      // open listing already on next code (JAM2 etc.) — leave it
    } else if(full){
      publicLobbies[size]={code:code, count:count|0, sealed:true};
    } else {
      publicLobbies[size]={code:code, count:count|0, sealed:false};
    }
    try{ renderPublicLobbies(); }catch(e){}
    try{
      if(window.GlobalBoard && GlobalBoard.isConfigured && GlobalBoard.isConfigured()
         && typeof GlobalBoard.publishLobby==='function'){
        GlobalBoard.publishLobby({size:size, code:code, count:count|0, sealed:!!full});
      }
    }catch(e){}
    // v832: mirror count to MQTT retain so remote clients see live occupancy without dreamlo lag
    try{
      if(window.MqttJam && window.MqttJam.publishCount){
        window.MqttJam.joinLobby(code);
        window.MqttJam.publishCount(code, count|0, !!full);
      }
    }catch(e){}
  }
  // v780: count-only updates. PeerJS forwards the number; board stores it.
  // Codes stay fixed. No full lobby re-fetch on a timer.
  function currentLobbyPlayers(){
    try{
      if(publicKind===4||publicKind===8||jamMode==='tournament'){
        const names=(tourney.players||[]).slice();
        if(myName) names.push(myName);
        const uniq=uniqRoster(names, myName);
        return Math.max(1, uniq.length);
      }
      if(roomCode) return partnerReady ? 2 : 1;
    }catch(e){}
    return 0;
  }
  function applyLobbyCount(kind, code, players, sealed){
    if(kind==null || !code) return;
    const cap=(kind===4||kind===8)?(kind|0):2;
    const n=Math.max(0, Math.min(cap, players|0));
    const prev=publicLobbies[kind];
    // v842: probes often timeout-as-free → 0/4 over a real full lobby. Never let a
    //   zero (or lower) probe clobber a higher recent count for the SAME code unless
    //   we are intentionally sealing/advancing away from that code.
    if(prev && prev.code===code && (prev.count|0)>n){
      const age=Date.now()-(prev._ts||0);
      // keep higher count for 12s unless new value is definitive sealed full
      if(age<12000 && !(sealed && n>=cap)){
        publicLobbies[kind]={code:code, count:prev.count|0, sealed:!!prev.sealed || (prev.count|0)>=cap, _ts:prev._ts||Date.now()};
        try{ renderPublicLobbies(); }catch(e){}
        return;
      }
    }
    publicLobbies[kind]={code:code, count:n, sealed:!!sealed || n>=cap, _ts:Date.now()};
    try{ renderPublicLobbies(); }catch(e){}
  }
  function broadcastLobbyCount(){
    try{
      if(!publicKind || !roomCode) return;
      const players=currentLobbyPlayers();
      const cap=(publicKind===4||publicKind===8)?(publicKind|0):2;
      const sealed=players>=cap;
      try{
        if(conn && conn.open){
          conn.send({type:'lobbyCount', kind:publicKind, room:roomCode, players:players, sealed:sealed});
        }
        if(window.__jamConns && window.__jamConns.length){
          window.__jamConns.forEach(function(c){
            try{ if(c&&c.open) c.send({type:'lobbyCount', kind:publicKind, room:roomCode, players:players, sealed:sealed}); }catch(e){}
          });
        }
      }catch(e){}
      // board write = count only (same fixed code)
      publishLobby(publicKind, roomCode, players, sealed);
    }catch(e){}
  }
  var _countPulse=null;
  function startCountPulse(){
    try{ if(_countPulse) clearInterval(_countPulse); }catch(e){}
    _countPulse=setInterval(function(){
      try{
        if(!roomCode || !publicKind) return;
        if(isHost) broadcastLobbyCount();
        // v832: MQTT presence heartbeat so remote probes see live seats
        if(window.MqttJam && window.MqttJam.publishPresence && mySeatCode){
          window.MqttJam.joinLobby(roomCode);
          window.MqttJam.publishPresence(roomCode, {
            nick: myName||'', seat: mySeatCode||'', isHost: !!isHost, ts: Date.now()
          });
        }
      }catch(e){}
    }, 1000);
  }
  function stopCountPulse(){
    try{ if(_countPulse) clearInterval(_countPulse); }catch(e){}
    _countPulse=null;
  }

  var _presenceSid=null;
  var _presencePulse=null;
  function presenceSid(){
    if(_presenceSid) return _presenceSid;
    try{ _presenceSid=sessionStorage.getItem('improvs2_live_sid'); }catch(e){}
    if(!_presenceSid){
      _presenceSid='S'+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
      try{ sessionStorage.setItem('improvs2_live_sid', _presenceSid); }catch(e){}
    }
    return _presenceSid;
  }
  function pulsePresence(){
    try{
      if(!roomCode) return;
      // only host publishes room presence (avoids double-count)
      if(!isHost) return;
      var players=1;
      try{ players=Math.max(1, currentLobbyPlayers()|0); }catch(e){}
      try{ if(tourney.players&&tourney.players.length) players=Math.max(players, tourney.players.length); }catch(e){}
      var kind=publicKind||(jamMode==='tournament'?'tourney':(jamMode||'priv'));
      if(window.GlobalBoard && GlobalBoard.publishPresence){
        GlobalBoard.publishPresence({sid:presenceSid(), players:players, kind:kind});
      }
      // also refresh lobby board count so outsiders see live numbers
      try{
        if(publicKind){
          const capP=(publicKind===4||publicKind===8)?(publicKind|0):2;
          publishLobby(publicKind, roomCode, players, players>=capP);
        }
      }catch(e){}
    }catch(e){}
  }
  function startPresencePulse(){
    try{ if(_presencePulse) clearInterval(_presencePulse); }catch(e){}
    pulsePresence();
    _presencePulse=setInterval(pulsePresence, 8000); // v803: every 8s
  }
  function stopPresencePulse(){
    try{ if(_presencePulse) clearInterval(_presencePulse); }catch(e){}
    _presencePulse=null;
  }

  function setJamBtnBadge(n){
    try{
      n=Math.max(0, n|0);
      window.__jamLivePlayers=n;
      var badge=document.getElementById('jamBtnBadge');
      var jb=document.getElementById('jamBtn');
      if(jb && !_turnOn){
        if(!document.getElementById('jamBtnBadge')){
          jb.innerHTML='🎸 JAM<span id="jamBtnBadge" style="display:none;position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:#22c55e;color:#052e16;font-size:0.65em;font-weight:900;line-height:16px;text-align:center;box-shadow:0 0 8px #22c55ecc;letter-spacing:0;">0</span>';
          badge=document.getElementById('jamBtnBadge');
        }
      }
      badge=document.getElementById('jamBtnBadge');
      if(badge){
        if(n>0){ badge.style.display='block'; badge.textContent=String(n>99?'99+':n); }
        else { badge.style.display='none'; badge.textContent='0'; }
      }
      if(jb && !_turnOn){
        jb.style.boxShadow=n>0?'0 0 12px #a78bfa, 0 2px 8px rgba(0,0,0,0.4)':'0 2px 8px rgba(0,0,0,0.4)';
      }
    }catch(e){}
  }

  async function refreshLivePop(){
    var el=document.getElementById('jamLivePop');
    if(!el) return;
    try{
      var sessions=0, players=0, seen={};

      // 1) local public lobby probes (always available, no dreamlo needed)
      try{
        [4,8,'jam','vs'].forEach(function(k){
          var L=publicLobbies[k];
          if(!L) return;
          var c=L.count|0;
          if(c>0 && !L.sealed){
            var id='local-'+k+'-'+(L.code||'');
            if(seen[id]) return;
            seen[id]=1;
            sessions++;
            players+=c;
          } else if(c>0 && L.sealed){
            // in-game still counts as live
            var id2='local-'+k+'-'+(L.code||'')+'-s';
            if(seen[id2]) return;
            seen[id2]=1;
            sessions++;
            players+=c;
          }
        });
      }catch(e){}

      // 2) this device's active room
      try{
        if(roomCode){
          var n=Math.max(currentLobbyPlayers()|0, (tourney.players&&tourney.players.length)|0, 1);
          var id='self-'+roomCode;
          if(!seen[id] && !seen['local-'+(publicKind||'')+'-'+roomCode]){
            seen[id]=1;
            sessions++;
            players+=n;
          }
        }
      }catch(e){}

      // 3) board LIVE + LOBBY entries (when dreamlo configured)
      try{
        if(window.GlobalBoard&&GlobalBoard.fetchAll){
          var entries=await GlobalBoard.fetchAll();
          var now=Date.now(), ttl=120000;
          (entries||[]).forEach(function(e){
            if(!e) return;
            if(e.isLive){
              var ts=e.ts|0;
              if(ts && (now-ts)>ttl) return;
              var id=String(e.sid||'')||('live'+sessions);
              if(seen[id]) return;
              seen[id]=1;
              sessions++;
              players+=(e.players|0)||1;
              return;
            }
            if(e.isLobby && (e.count|0)>0){
              var id='board-'+(e.lobbyKey||'')+'-'+(e.code||'');
              if(seen[id]) return;
              // skip if we already counted this local lobby
              var localKey='local-'+(e.lobbyKey||e.lobbySize)+'-'+(e.code||'');
              if(seen[localKey]) return;
              seen[id]=1;
              sessions++;
              players+=(e.count|0);
            }
          });
        }
      }catch(e){}

      el.textContent = sessions===0
        ? 'Live now: 0 lobbies · 0 players'
        : ('Live now: '+sessions+' lobby'+(sessions===1?'':'ies')+' · ~'+players+' player'+(players===1?'':'s'));
      try{
        window.__jamLiveLobbies=sessions|0;
        setJamBtnBadge(players|0);
      }catch(e){}
    }catch(e){ el.textContent='Live now: —'; }
  }

  // v793: heartbeat is soft-only. Lobby wait is SILENT by design — players can sit
  // for minutes without chatting. Never kick a waiting lobby for "no heartbeat".
  // Soft ping every 15s keeps NAT mappings warm; timeout only notes status, never showIdle.
  var _hbTimer=null, _hbLastSeen=0, _hbMiss=0;
  var HB_INTERVAL_MS=15000;  // gentle ping
  var HB_MISS_MAX=8;         // ~2 minutes of silence before soft flag
  function stopHeartbeat(){
    try{ if(_hbTimer) clearInterval(_hbTimer); }catch(e){}
    _hbTimer=null; _hbMiss=0; _hbLastSeen=0;
  }
  function onPeerAlive(){
    _hbLastSeen=Date.now();
    _hbMiss=0;
  }
  function handlePeerTimeout(){
    // v793: NEVER destroy a lobby for silence. Host keeps waiting; joiners keep seat.
    try{
      if(isHost && roomCode){
        setStatus('Hosting '+roomCode+' — still waiting (peer quiet)…');
        try{ broadcastLobbyCount(); }catch(e){}
        _hbMiss=0;
        _hbLastSeen=Date.now();
        return; // stay in session
      }
      // joiner: soft message only if conn really dead
      if(!conn || !conn.open){
        setStatus('Host quiet — still in lobby. Tap JOIN again only if stuck.');
        _hbMiss=0;
        return;
      }
      setStatus('Peer quiet — connection still open.');
      _hbMiss=0;
    }catch(e){}
  }
  function startHeartbeat(){
    stopHeartbeat();
    _hbLastSeen=Date.now();
    _hbMiss=0;
    _hbTimer=setInterval(function(){
      try{
        // soft ping to keep link warm — no lobby destruction
        if(conn && conn.open){
          try{ conn.send({type:'ping', t:Date.now(), room:roomCode||''}); }catch(e){}
          if(_hbLastSeen && (Date.now()-_hbLastSeen) > HB_INTERVAL_MS*HB_MISS_MAX){
            _hbMiss++;
            if(_hbMiss>=HB_MISS_MAX) handlePeerTimeout();
          }
        } else if(isHost && roomCode){
          // host with no active conn = alone in lobby, fine
          _hbMiss=0;
        } else {
          _hbMiss++;
          if(_hbMiss>=HB_MISS_MAX) handlePeerTimeout();
        }
      }catch(e){}
    }, HB_INTERVAL_MS);
  }
  let _lobbyBoardOk=false;
  function _seedDefaultSlots(){
    // always keep a visible fixed code so the UI never goes EMPTY
    [4,8,'jam','vs'].forEach(function(n){
      const slots=slotsFor(n);
      const def=(slots&&slots[0])||((n===4||n===8)?(n+'PT1'):String(n));
      if(!publicLobbies[n] || !publicLobbies[n].code){
        publicLobbies[n]={code:def, count:0, sealed:false};
      }
    });
  }
  async function refreshPublicLobbies(){
    // v777: fixed slots mean every device already agrees on the code set.
    // Board only supplies live counts / which slot is currently open.
    // If the board is unreachable, keep showing 4PT1 / 8PT1 / JAM1 / VS1 at 0/N.
    _seedDefaultSlots();
    try{
      if(!window.GlobalBoard||!GlobalBoard.fetchAll||!(!GlobalBoard.isConfigured||GlobalBoard.isConfigured())){
        _lobbyBoardOk=false; renderPublicLobbies(); return;
      }
      const entries=await GlobalBoard.fetchAll();
      _lobbyBoardOk=true;
      // pick the open (unsealed) lobby with the latest date per kind; if all sealed,
      // advance to the next fixed slot after the latest sealed one
      const open={4:null,8:null,jam:null,vs:null};
      const sealedLatest={4:null,8:null,jam:null,vs:null};
      entries.forEach(function(e){
        if(!e.isLobby||!e.code) return;
        const key=(e.lobbyKey!=null)?e.lobbyKey:e.lobbySize;
        if(key!==4&&key!==8&&key!=='jam'&&key!=='vs') return;
        if(e.sealed){
          if(!sealedLatest[key] || (e.date&&sealedLatest[key].date&&e.date>sealedLatest[key].date)) sealedLatest[key]=e;
          return;
        }
        if(!open[key] || (e.date&&open[key].date&&e.date>open[key].date)) open[key]=e;
      });
      [4,8,'jam','vs'].forEach(function(n){
        const slots=slotsFor(n)||[];
        const cap=(n===4||n===8)?(n|0):2;
        if(open[n]){
          publicLobbies[n]={code:open[n].code, count:open[n].count|0, sealed:false};
          return;
        }
        // no open entry — if something was just sealed, advance to the next fixed slot
        if(sealedLatest[n] && slots.length){
          const i=slots.indexOf(sealedLatest[n].code);
          const next=slots[(i>=0?i+1:0)%slots.length];
          publicLobbies[n]={code:next, count:0, sealed:false};
          return;
        }
        publicLobbies[n]={code:slots[0]||((n===4||n===8)?(n+'PT1'):String(n)), count:0, sealed:false};
      });
      renderPublicLobbies();
    }catch(e){
      _lobbyBoardOk=false;
      _seedDefaultSlots();
      renderPublicLobbies();
    }
  }
  function renderBracket(){
    const el=document.getElementById('jamBracketHtml'); if(!el) return;
    if(!tourney.players.length){ el.textContent='Waiting for players…'; return; }
    try{ clampRosterToCap(); }catch(e){}
    let h='<div style="margin-bottom:4px;color:#fbbf24;">Players '+Math.min(tourney.players.length,rosterCap())+'/'+rosterCap()+'</div>';
    tourney.players.forEach(function(p,i){
      var tag='';
      if(p===myName) tag=' <span style="color:#6ee7b7;">(you)</span>';
      else if(isBotName(p)) tag=' <span style="color:#94a3b8;font-size:0.85em;">BOT</span>';
      var eloStr='';
      try{ if(!isBotName(p)) eloStr=' <span style="color:#64748b;font-size:0.8em;">'+getElo(p)+'</span>'; }catch(e){}
      h+='<div>'+(i+1)+'. '+p+tag+eloStr+'</div>';
    });
    if(tourney.bracket&&tourney.bracket.length){
      h+='<div style="margin-top:8px;color:#fbbf24;">Bracket</div>';
      tourney.bracket.forEach(function(rnd,ri){
        h+='<div style="margin-top:4px;color:#aaa;">R'+(ri+1)+'</div>';
        rnd.forEach(function(m){
          const a=m.a||'TBD', b=m.b||'TBD';
          const w=m.winner?(' → <b style="color:#ffd700;">'+m.winner+'</b>'):'';
          h+='<div style="padding-left:6px;">'+a+' vs '+b+w+'</div>';
        });
      });
    }
    el.innerHTML=h;
    // spectate player chips
    const bar=document.getElementById('jamSpecBar');
    const host=document.getElementById('jamSpecPlayers');
    if(bar&&host){
      bar.style.display=(isSpectator||tourney.active)?'block':'none';
      host.innerHTML='';
      tourney.players.forEach(function(p){
        const b=document.createElement('button');
        b.textContent=p;
        b.style.cssText='padding:3px 8px;border-radius:4px;border:1px solid #445;background:#1e293b;color:#e2e8f0;font-size:0.65em;font-weight:900;cursor:pointer;';
        b.addEventListener('click', function(){
          window.__specFocus=p;
          document.querySelectorAll('#jamSpecPlayers button').forEach(function(x){ x.style.borderColor='#445'; });
          b.style.borderColor='#38bdf8';
          const rb=document.getElementById('jamSpecReplay');
          if(rb){ rb.style.display=tourney.replays&&tourney.replays[p]?'block':'none'; }
          setStatus('Spectating '+p);
        });
        host.appendChild(b);
      });
    }
  }
  function buildBracket(names){
    var n=tourney.size, list=names.slice(0,n);
    while(list.length<n) list.push(null);
    for(var i=list.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=list[i]; list[i]=list[j]; list[j]=t; }
    var rounds=[], cur=[];
    for(var i=0;i<list.length;i+=2) cur.push({a:list[i],b:list[i+1],winner:null});
    rounds.push(cur);
    var sz=cur.length;
    while(sz>1){ var next=[]; for(var i=0;i<sz;i+=2) next.push({a:null,b:null,winner:null}); rounds.push(next); sz=next.length; }
    return rounds;
  }
  function awardTournamentChampion(size){
    try{
      const s=size||tourney.size||4;
      // 8-player crowns worth more
      const auraPts=s>=8?12:s>=4?6:3;
      if(window.Aura&&Aura.award) Aura.award(auraPts,'tournament-champion-'+s);
      try{
        var d=JSON.parse(localStorage.getItem('improvs2_loot')||'{}');
        d.inv=d.inv||{common:0,rare:0,epic:0,legendary:0};
        d.inv.legendary=(d.inv.legendary||0)+(s>=8?2:1);
        if(s>=8) d.rareTok=(d.rareTok||0)+3;
        else d.rareTok=(d.rareTok||0)+1;
        localStorage.setItem('improvs2_loot',JSON.stringify(d));
        if(window.Loot&&Loot.render) Loot.render();
      }catch(e){}
      setStatus('🏆 CHAMPION ('+s+'-player)! Rewards granted.');
    }catch(e){}
  }
  function maybeResolveVersus(){
    if(vsMyScore==null||vsTheirScore==null) return;
    const mine=vsMyScore.score, theirs=vsTheirScore.score;
    const res=document.getElementById('jamVsResult');
    let msg='You '+mine+' vs '+vsTheirScore.nick+' '+theirs+' — ';
    if(mine>theirs){ msg+='YOU WIN'; try{ if(window.Aura&&Aura.award) Aura.award(3,'versus-win'); }catch(e){} }
    else if(mine<theirs){ msg+='YOU LOSE'; window.__vsLoserReplay={rep:vsTheirScore.rep,nick:vsTheirScore.nick}; }
    else msg+='DRAW';
    // v845: Elo update (real players only)
    try{ eloApplyVersus(vsMyScore.nick||myName, vsTheirScore.nick, mine, theirs); }catch(e){}
    try{
      var eMe=getElo(vsMyScore.nick||myName), eThem=getElo(vsTheirScore.nick);
      msg+='  ·  Elo '+eMe+' / '+eThem;
    }catch(e){}
    if(res){ res.style.display='block'; res.textContent=msg; }
    // stash replays for spectate
    if(vsMyScore.nick) tourney.replays[vsMyScore.nick]=vsMyScore.rep;
    if(vsTheirScore.nick) tourney.replays[vsTheirScore.nick]=vsTheirScore.rep;
    try{ if(conn&&conn.open) conn.send({type:'vsResolved', mine:vsMyScore, theirs:vsTheirScore}); }catch(e){}
  }
  function autoStartIfFull(){
    if(!isHost||tourney.active) return;
    if(tourney.players.length>=tourney.size){
      tourney.bracket=buildBracket(tourney.players);
      tourney.round=0; tourney.matchIdx=0; tourney.active=true;
      renderBracket();
      try{ if(conn&&conn.open) conn.send({type:'tourneyState', tourney:tourney}); }catch(e){}
      setStatus('Lobby full — tournament started!');
      // seal old lobby + mint a new public code for the next queue
      const sz=tourney.size;
      // v774: next fixed tourney slot instead of random
      (async function(){
        const next=await pickOpenSlot(sz) || (slotsFor(sz)||[(sz===4||sz===8)?(sz+'PT1'):('T'+sz)])[0];
        publishLobby(sz, next, 0, false);
      })();
    }
  }
  function addTourneyPlayer(name){
    if(!name) return;
    // normalize double-tags
    const seatM=String(name).toUpperCase().match(/-([A-Z]*\d+[A-H]?)$/);
    const clean=seatM?(baseNick(name)+'-'+seatM[1]):baseNick(name);
    // already seated?
    if((tourney.players||[]).some(function(p){ return String(p).toLowerCase()===String(clean).toLowerCase(); })) return;
    clampRosterToCap();
    var cap=rosterCap();
    if((tourney.players||[]).length>=cap){
      // free a bot seat for a real player if possible
      var bi=-1;
      for(var i=tourney.players.length-1;i>=0;i--){ if(isBotName(tourney.players[i])){ bi=i; break; } }
      if(bi>=0){
        var gone=tourney.players.splice(bi,1)[0];
        try{ delete tourneyBots[gone]; }catch(e){}
      } else {
        setStatus('Lobby full ('+cap+'/'+cap+') — cannot add '+clean);
        return;
      }
    }
    tourney.players.push(clean);
    tourney.players=uniqRoster(tourney.players, myName);
    clampRosterToCap();
    renderBracket();
    autoStartIfFull();
    try{ if(conn&&conn.open) conn.send({type:'tourneyLobby', players:tourney.players, size:tourney.size}); }catch(e){}
    try{ if(publicKind && roomCode) broadcastLobbyCount(); }catch(e){}
    try{ updateLobby(); }catch(e){}
  }

  const HANDSHAKE_MS=4000;     // time given for both sides to load/decode the track before it fires
  // v747: buffer is ONE TURN of the shared track's meter — not a fixed 16s NinJam audio interval.
  //   We only ship tiny note events (both sides already have the audio + instrument). Players
  //   trade bars: you play a turn while they listen, then hear their turn land on the next cycle.
  //   4/4 → 2 bars (8/4 feel), 3/4 → 2 bars (6/4 feel); other meters use 1 bar.
  let jamBufferSec=2;          // live value; recomputed when a shared track starts
  let jamBufferBars=1;
  let jamBufferLabel='2s';

  function beatsPerBarFromTs(ts){
    try{
      if(!ts || ts==='free') return 4;
      const m=String(ts).match(/(\d+)\s*\/\s*(\d+)/);
      if(!m) return 4;
      const top=parseInt(m[1],10);
      return (top>=1 && top<=16) ? top : 4;
    }catch(e){ return 4; }
  }
  function barsPerTurn(ts){
    // v748: compound the written bar into a guitar "double bar" turn:
    //   4/4 → 2 bars (8/4 feel), 3/4 → 2 bars (6/4 feel).
    //   Other meters (6/8, 5/4, free, …) stay at 1 written bar.
    try{
      if(!ts || ts==='free') return 2;
      const m=String(ts).match(/(\d+)\s*\/\s*(\d+)/);
      if(m){
        const top=parseInt(m[1],10), bot=parseInt(m[2],10);
        if(top===4 && bot===4) return 2;   // 8/4 guitar turn
        if(top===3 && bot===4) return 2;   // 6/4 guitar turn
      }
    }catch(e){}
    return 1;
  }
  function setJamBufferFromTrack(track){
    const bpm=Math.max(30, Math.min(300, Number(track && track.bpm) || 100));
    const ts=(track && track.ts) || '4/4';
    const bpb=beatsPerBarFromTs(ts);
    const bars=barsPerTurn(ts);
    const sec=bars * bpb * (60 / bpm);
    // Floor ~1.2s so a fast/short bar never under-runs typical mobile WebRTC jitter
    jamBufferSec=Math.max(1.2, sec);
    jamBufferBars=bars;
    const beats=bars*bpb;
    jamBufferLabel=bars+' bar'+(bars>1?'s':'')+' ('+beats+' beats · '+jamBufferSec.toFixed(1)+'s)';
    return jamBufferSec;
  }
  function jamDelay(fn){ setTimeout(fn, jamBufferSec*1000); }

  // v770: red/green take-turn light — SOFT guidance only (never mutes or cuts audio)
  let _turnRAF=null, _turnEpoch=0, _turnOn=false;
  // v840: note capture (other script) asks this to tag notes green/red for scoring
  window.__jamIsMyTurn=function(){
    try{
      if(!_turnOn || !_turnEpoch) return null;
      const period=Math.max(1200, (jamBufferSec||2)*1000);
      const phase=Math.floor(Math.max(0, Date.now()-_turnEpoch) / period);
      const hostTurn=(phase % 2)===0;
      return isHost ? hostTurn : !hostTurn;
    }catch(e){ return null; }
  };
  window.__jamTurnActive=function(){ return !!_turnOn; };
  function stopTurnLight(){
    _turnOn=false;
    if(_turnRAF){ try{ cancelAnimationFrame(_turnRAF); }catch(e){} _turnRAF=null; }
    const box=document.getElementById('jamTurnBox');
    const fl=document.getElementById('jamTurnFloat');
    if(box) box.style.display='none';
    if(fl) fl.style.display='none';
    // restore purple JAM + live count
    try{
      const jb=document.getElementById('jamBtn');
      if(jb){
        jb.style.background='#7c3aed';
        jb.style.color='#fff';
        jb.style.boxShadow=(window.__jamLivePlayers|0)>0
          ? '0 0 12px #a78bfa, 0 2px 8px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.4)';
        var n=window.__jamLivePlayers|0;
        jb.innerHTML='🎸 JAM<span id="jamBtnBadge" style="display:'+(n>0?'block':'none')+';position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:#22c55e;color:#052e16;font-size:0.65em;font-weight:900;line-height:16px;text-align:center;box-shadow:0 0 8px #22c55ecc;letter-spacing:0;">'+(n>0?n:0)+'</span>';
      }
    }catch(e){}
  }
  function startTurnLight(epoch){
    if(!noteRelay || jamMode!=='jam'){ stopTurnLight(); return; }
    _turnEpoch = epoch || window._jamSyncEpoch || Date.now();
    _turnOn = true;
    const box=document.getElementById('jamTurnBox');
    const fl=document.getElementById('jamTurnFloat');
    if(box) box.style.display='block';
    if(fl) fl.style.display='flex';
    tickTurnLight();
  }
  function tickTurnLight(){
    if(!_turnOn) return;
    try{
      const now=Date.now();
      const period=Math.max(1200, (jamBufferSec||2)*1000);
      const elapsed=Math.max(0, now - _turnEpoch);
      const phase=Math.floor(elapsed / period);
      // Host takes even phases (0,2,4…), joiner odd — both sides agree from shared epoch
      const hostTurn = (phase % 2) === 0;
      const myTurn = isHost ? hostTurn : !hostTurn;
      const remainMs = period - (elapsed % period);
      const remainS = (remainMs/1000).toFixed(1);
      const who = myTurn ? 'YOU' : (partnerName||'THEM');

      const light=document.getElementById('jamTurnLight');
      const label=document.getElementById('jamTurnLabel');
      const sub=document.getElementById('jamTurnSub');
      const count=document.getElementById('jamTurnCount');
      const fdot=document.getElementById('jamTurnFloatDot');
      const ftxt=document.getElementById('jamTurnFloatTxt');

      if(myTurn){
        if(light){ light.style.background='#22c55e'; light.style.boxShadow='0 0 22px #22c55ecc, 0 0 0 3px #14532d'; }
        if(label){ label.textContent='GREEN · PLAY'; label.style.color='#4ade80'; }
        if(sub) sub.textContent='Your window · soft cue only — keep going if the solo is flowing.';
        if(fdot){ fdot.style.background='#22c55e'; fdot.style.boxShadow='0 0 10px #22c55e'; }
        if(ftxt){ ftxt.textContent='PLAY · '+remainS+'s'; ftxt.style.color='#4ade80'; }
        // JAM button alternates with the turn light
        try{
          const jb=document.getElementById('jamBtn');
          if(jb){
            jb.style.background='#16a34a';
            jb.style.boxShadow='0 0 14px #22c55ecc, 0 2px 8px rgba(0,0,0,0.4)';
            jb.style.color='#fff';
            jb.innerHTML='▶ PLAY';
          }
        }catch(e){}
      } else {
        if(light){ light.style.background='#ef4444'; light.style.boxShadow='0 0 22px #ef4444cc, 0 0 0 3px #7f1d1d'; }
        if(label){ label.textContent='RED · LISTEN'; label.style.color='#f87171'; }
        if(sub) sub.textContent='Their window · no hard mute. If you already took off, finish the line.';
        if(fdot){ fdot.style.background='#ef4444'; fdot.style.boxShadow='0 0 10px #ef4444'; }
        if(ftxt){ ftxt.textContent='LISTEN · '+remainS+'s'; ftxt.style.color='#f87171'; }
        try{
          const jb=document.getElementById('jamBtn');
          if(jb){
            jb.style.background='#dc2626';
            jb.style.boxShadow='0 0 14px #ef4444cc, 0 2px 8px rgba(0,0,0,0.4)';
            jb.style.color='#fff';
            jb.innerHTML='👂 LISTEN';
          }
        }catch(e){}
      }
      if(count) count.textContent='Turn '+(phase+1)+' · every '+jamBufferLabel+' · '+(hostTurn?'host':'joiner')+' lead this slot';
    }catch(e){}
    _turnRAF=requestAnimationFrame(tickTurnLight);
  }

  function setStatus(s){ const el=document.getElementById('jamStatus'); if(el) el.textContent=s; }
  function showActive(code){
    document.getElementById('jamIdle').style.display='none';
    document.getElementById('jamActive').style.display='block';
    document.getElementById('jamRoomCode').textContent=code;
    try{ startPresencePulse(); }catch(e){}
  }
  function showIdle(){
    document.getElementById('jamIdle').style.display='block';
    document.getElementById('jamActive').style.display='none';
    try{ stopTurnLight(); }catch(e){}
    try{ stopPresencePulse(); }catch(e){}
  }
  function updateLobby(){
    const el=document.getElementById('jamLobby');
    if(!el) return;
    // v787: tournament uses the real roster — never "2/2 you & me" for one player
    if(jamMode==='tournament'){
      const names=(tourney.players||[]).slice();
      if(myName) names.unshift(myName);
      const uniq=uniqRoster(names, myName);
      // keep tourney.players clean
      try{ tourney.players=uniq.slice(); }catch(e){}
      const cap=tourney.size||publicKind||4;
      el.textContent = uniq.length
        ? (uniq.length+'/'+cap+' in lobby — '+uniq.map(function(n){
            var mine=myName&&String(n)===String(myName);
            return mine?n+' (you)':n;
          }).join(', '))
        : ('Waiting for players… 0/'+cap);
      try{
        if(publicKind && roomCode && uniq.length){
          applyLobbyCount(publicKind, roomCode, uniq.length, false);
          setJamBtnBadge(uniq.length);
        }
      }catch(e){}
      // v845: host schedules bot fill if under capacity (empty seats 6–8 etc.)
      try{
        if(isHost && !tourney.active && uniq.length>0 && uniq.length<rosterCap()){
          scheduleBotFill(28000);
        }
      }catch(e){}
      return;
    }
    if(!conn || !conn.open){ el.textContent='Waiting for partner…'; return; }
    el.textContent = partnerReady ? ('2/2 in lobby — you & '+(partnerName||'partner')) : 'Connected — waiting on partner info…';
  }
  function addChatLine(who, text){
    const log=document.getElementById('jamChatLog'); if(!log) return;
    const d=document.createElement('div');
    d.style.marginBottom='3px';
    const isMe=(who==='me' || (myName && String(who).toLowerCase()===String(myName).toLowerCase()));
    let label=isMe?(myName||'you'):(who||'');
    if(!label || /^player$/i.test(label) || /^them$/i.test(label)){
      label=partnerName||myName||'Player';
    }
    d.innerHTML='<b style="color:'+(isMe?'#6ee7b7':'#93c5fd')+';">'+label+':</b> '+String(text||'');
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  }

  function jamSendAll(msg, skipConn){
    try{
      var seen={};
      function sendOne(c){
        if(!c || !c.open || c===skipConn) return;
        try{ if(c.peer){ if(seen[c.peer]) return; seen[c.peer]=1; } }catch(e){}
        try{ c.send(msg); }catch(e){}
      }
      sendOne(conn);
      if(window.__jamConns) window.__jamConns.forEach(sendOne);
    }catch(e){}
  }
  function wireConn(c){
    // v810: never double-bind the same DataConnection (was causing duplicate chat lines)
    if(!c) return;
    if(c.__jamWired){ conn=c; return; }
    c.__jamWired=true;
    if(!window.__jamConns) window.__jamConns=[];
    if(window.__jamConns.indexOf(c)<0) window.__jamConns.push(c);
    conn=c;
    function onOpen(){
      showActive(roomCode);
      updateLobby();
      setLight(true);
      try{ c.send({type:'hello', name:myName||'Anonymous', role:'player', publicKind:publicKind, lobbySize:tourney.size||publicKind, seat:mySeatCode||''}); }catch(e){}
      try{ if(publicKind && roomCode) broadcastLobbyCount(); }catch(e){}
    }
    if(c.open){ onOpen(); }
    else { c.on('open', onOpen); }
    c.on('data', (data)=>{
      try{
        if(!data||!data.type) return;
        // any packet proves the peer is alive
        try{ onPeerAlive(); }catch(e){}
        // v818: star topology — joiners only connect to host, not each other. A message
        // sent BY a joiner (trackPropose/trackAccept/trackDecline/bk/etc.) previously only
        // reached the host; in 3+ player jam lobbies the other joiners never saw it, never
        // started the track, never recorded → they scored 0/F. Host now fans out any
        // un-relayed message from a joiner to every other connection automatically.
        if(isHost && !data._relayed && ['trackPropose','trackAccept','trackDecline','bk'].indexOf(data.type)>=0){
          try{ window.jamHud&&window.jamHud('relay '+data.type+' from '+(c&&c.peer)+' → all others'); }catch(e){}
          try{ jamSendAll(Object.assign({}, data, {_relayed:true}), c); }catch(e){}
        }
        if(data.type==='ping'){
          try{ if(conn&&conn.open) conn.send({type:'pong', t:data.t||Date.now(), room:roomCode||''}); }catch(e){}
          return;
        }
        if(data.type==='pong'){
          return;
        }
        if(data.type==='hello'){
          const role=data.role||'player';
          // v783: probe connections only want the live count — never join the session
          if(role==='probe'){
            try{
              const players=currentLobbyPlayers();
              const cap=(publicKind===4||publicKind===8)?(publicKind|0):2;
              conn.send({type:'lobbyCount', kind:publicKind||data.publicKind||'jam', room:roomCode||data.room||'', players:players, sealed:players>=cap});
            }catch(e){}
            try{ setTimeout(function(){ try{ conn.close(); }catch(e){} }, 80); }catch(e){}
            return;
          }
          // v837: was const — reassignment when data.seat is set threw and aborted the
          // entire hello handler, so partnerReady never flipped true (both sides stuck on
          // "waiting on partner info" with an open PeerJS link).
          let incomingName=(data.name||'partner').trim();
          // v808: only ignore exact duplicate hello (same full seat name)
          if(isHost && myName && incomingName && incomingName.toLowerCase()===String(myName).toLowerCase()){
            try{ broadcastLobbyCount(); }catch(e){}
            // still refresh roster for tourney
          }
          // prefer seat-tagged display name
          if(data.seat) incomingName=seatTaggedName(baseNick(incomingName||'Player'), data.seat);
          partnerName=incomingName||'partner'; partnerReady=true;
          try{
            if(!window.__jamPeerNames) window.__jamPeerNames={};
            if(c && c.peer) window.__jamPeerNames[c.peer]=partnerName;
          }catch(e){}
          if(data.lobbySize && (data.lobbySize===4||data.lobbySize===8)) tourney.size=data.lobbySize|0;
          if(data.publicKind) publicKind=data.publicKind;
          setStatus('Connected — mode '+jamMode+(role==='spec'?' (spectator)':''));
          updateLobby();
          try{ startHeartbeat(); }catch(e){}
          try{
            if(isHost && publicKind && roomCode && role!=='spec'){
              broadcastLobbyCount();
              if(publicKind==='jam'||publicKind==='vs'){
                try{ rotatePublicIfFull(); }catch(e2){}
              }
            } else {
              try{ broadcastLobbyCount(); }catch(e3){}
            }
          }catch(e){}
          if((jamMode==='tournament' || isTourneySize(publicKind)) && isHost && role!=='spec'){
            tourney.players=uniqRoster((tourney.players||[]).concat([myName, partnerName].filter(Boolean)), myName);
            try{ clampRosterToCap(); }catch(e){}
            tourney.size=tourney.size||publicKind||4;
            renderBracket();
            try{ jamSendAll({type:'tourneyLobby', players:tourney.players, size:tourney.size}); }catch(e){}
            try{ applyLobbyCount(publicKind||tourney.size, roomCode, tourney.players.length, false); }catch(e){}
            publishLobby(publicKind||tourney.size, roomCode, Math.max(1, tourney.players.length), !!tourney.active);
            try{ updateLobby(); }catch(e){}
            try{ broadcastLobbyCount(); }catch(e){}
            try{ setJamBtnBadge(Math.max(1, tourney.players.length)); }catch(e){}
          }
          if((jamMode==='versus'||jamMode==='tournament') && !isSpectator){
            const btn=document.getElementById('jamVsSubmitScore'); if(btn) btn.style.display='block';
          }
          if(isSpectator||role==='spec'){
            const bar=document.getElementById('jamSpecBar'); if(bar) bar.style.display='block';
          }
        } else if(data.type==='lobbyCount'){
          // peer-forwarded player count only — never replaces the fixed code set
          try{
            const kind=data.kind!=null?data.kind:publicKind;
            const code=data.room||roomCode||'';
            applyLobbyCount(kind, code, data.players|0, !!data.sealed);
          }catch(e){}
        } else if(data.type==='chat'){
          var who=data.from||'';
          if(!who || who==='player' || who==='Player' || who==='them' || who==='me'){
            try{ who=(c&&c.peer&&window.__jamPeerNames&&window.__jamPeerNames[c.peer])||''; }catch(e){}
          }
          if(!who) who=partnerName||'Player';
          // dedupe: same from+text within 800ms (double handler / relay echo)
          try{
            if(!window.__jamChatSeen) window.__jamChatSeen={};
            var key=String(who).toLowerCase()+'|'+String(data.text||'');
            var now=Date.now();
            if(window.__jamChatSeen[key] && (now-window.__jamChatSeen[key])<800){
              // still relay if host and not yet relayed
              if(isHost && !data._relayed) jamSendAll({type:'chat', text:data.text, from:who, _relayed:true}, c);
              return;
            }
            window.__jamChatSeen[key]=now;
          }catch(e){}
          if(!(data._relayed && myName && String(who).toLowerCase()===String(myName).toLowerCase())){
            addChatLine(who, data.text);
          }
          // roster repair: any named chat confirms presence
          try{
            if(who && tourney && isTourneySize(publicKind||tourney.size)){
              // real chatter can displace a bot if at cap
              if((tourney.players||[]).length>=rosterCap() && !(tourney.players||[]).some(function(p){ return String(p).toLowerCase()===String(who).toLowerCase(); })){
                var bi=-1;
                for(var i=tourney.players.length-1;i>=0;i--){ if(isBotName(tourney.players[i])){ bi=i; break; } }
                if(bi>=0){ var g=tourney.players.splice(bi,1)[0]; try{ delete tourneyBots[g]; }catch(e){} }
              }
              tourney.players=uniqRoster((tourney.players||[]).concat([myName, who].filter(Boolean)), myName);
              clampRosterToCap();
              updateLobby(); renderBracket();
              var n=Math.min(tourney.players.length, rosterCap());
              applyLobbyCount(publicKind||tourney.size, roomCode, n, n>=rosterCap());
              if(isHost){ publishLobby(publicKind||tourney.size, roomCode, n, n>=rosterCap()); broadcastLobbyCount(); }
              setJamBtnBadge(n);
            }
          }catch(e){}
          if(isHost && !data._relayed){
            jamSendAll({type:'chat', text:data.text, from:who, _relayed:true}, c);
          }
        } else if((data.type==='noteOn' || data.type==='note') && noteRelay){
          // v744/v745: noteOn carries an id so pitch/bend/noteOff can target the same remote voice.
          const nid=data.id;
          jamDelay(()=>{
            try{
              window.__jamPlayingRemote=true;
              const v=makeVoice(data.m, data.vel);
              if(nid!=null && v) remoteVoices[nid]=v;
            }finally{ window.__jamPlayingRemote=false; }
          });
        } else if(data.type==='noteOff' && noteRelay){
          const nid=data.id;
          if(nid==null) return;
          jamDelay(()=>{
            try{
              const v=remoteVoices[nid];
              if(v){ try{ v.release(!!data.fast); }catch(e){} delete remoteVoices[nid]; }
            }catch(e){}
          });
        } else if(data.type==='pitch' && noteRelay){
          // hammer-on / pull-off / slide on an already-ringing remote voice
          const nid=data.id;
          if(nid==null) return;
          jamDelay(()=>{
            try{
              const v=remoteVoices[nid];
              if(v && v.pitchTo){ window.__jamPlayingRemote=true; try{ v.pitchTo(data.m, !!data.glide); }finally{ window.__jamPlayingRemote=false; } }
            }catch(e){}
          });
        } else if(data.type==='bend' && noteRelay){
          const nid=data.id;
          if(nid==null) return;
          jamDelay(()=>{
            try{
              const v=remoteVoices[nid];
              if(v && v.bend){ window.__jamPlayingRemote=true; try{ v.bend(data.semis||0); }finally{ window.__jamPlayingRemote=false; } }
            }catch(e){}
          });
        } else if(data.type==='harm' && noteRelay){
          jamDelay(()=>{
            try{
              window.__jamPlayingRemote=true;
              try{ if(window.playHarmonicChime) window.playHarmonicChime(data.m, data.vel, data.str); }finally{ window.__jamPlayingRemote=false; }
            }catch(e){}
          });
        } else if(data.type==='trackPropose'){
          const v=document.getElementById('jamTrackVote'), t=document.getElementById('jamTrackVoteText');
          if(v && t){
            const who=data.from||partnerName||'A player';
            t.textContent=who+' wants to play "'+data.title+'" ('+data.bpm+' BPM). Accept to ready-up (2 accepts starts).';
            v.style.display='block';
            v.dataset.trackId=data.trackId; v.dataset.bpm=data.bpm;
            try{ v._pendingTrack=data.track||null; }catch(e){}
            window.__jamPendingTrack=data.track||null;
          }
        } else if(data.type==='trackDecline'){
          setStatus((data.from||partnerName||'Partner')+' declined that track.');
          if(window.__jamVote){ window.__jamVote.accepts=0; window.__jamVote.names=[]; }
        } else if(data.type==='trackAccept'){
          // v797: need 2 accepts (proposer already counts as 1) then start for everyone
          if(!window.__jamVote) window.__jamVote={accepts:0, names:[], track:null};
          const nm=data.from||partnerName||'player';
          if(window.__jamVote.names.indexOf(nm)<0){
            window.__jamVote.names.push(nm);
            window.__jamVote.accepts=(window.__jamVote.accepts|0)+1;
          }
          const need=2;
          setStatus('Track votes: '+window.__jamVote.accepts+'/'+need+' (incl. proposer)');
          const track=pendingProposal||window.__jamVote.track||window.__jamPendingTrack;
          if(track && (window.__jamVote.accepts|0)>=need){
            const startAtEpoch=Date.now()+HANDSHAKE_MS;
            jamSendAll({type:'bk', trackId:track.id, bpm:track.bpm, startAtEpoch:startAtEpoch, track:track});
            startSharedTrack(track, startAtEpoch);
            pendingProposal=null;
            window.__jamVote={accepts:0, names:[], track:null};
          }
        } else if(data.type==='bk'){
          try{
            const track=data.track || {id:data.trackId, bpm:data.bpm, title:'track'};
            // shared jam track plays even if locked locally
            window.__jamSharedUnlock=true;
            startSharedTrack(track, data.startAtEpoch);
          }catch(e){ setStatus('Could not start shared track: '+(e&&e.message||e)); }
        } else if(data.type==='mode'){
          if(data.mode) setJamMode(data.mode);
          if(data.tourneySize) setTourneySize(data.tourneySize);
        } else if(data.type==='vsScore'){
          if(!(data._relayed && data.nick && myName && String(data.nick).toLowerCase()===String(myName).toLowerCase())){
            vsTheirScore={score:data.score|0, grade:data.grade||'—', nick:data.nick||partnerName||'them', rep:data.rep||null, trackId:data.trackId||null};
            if(!window.__jamScores) window.__jamScores={};
            window.__jamScores[vsTheirScore.nick]=vsTheirScore;
            setStatus('Received '+vsTheirScore.nick+"'s score: "+vsTheirScore.score);
            if(isHost && !data._relayed){
              jamSendAll({type:'vsScore', score:vsTheirScore.score, grade:vsTheirScore.grade, nick:vsTheirScore.nick, rep:vsTheirScore.rep, trackId:vsTheirScore.trackId, _relayed:true}, c);
            }
            try{ jamMaybeResolveRound(); }catch(e){}
            maybeResolveVersus();
          }
        } else if(data.type==='jamRoundResult'){
          try{
            // v833: delay winner splash so local judging panel stays visible first
            if(data.payload) setTimeout(function(){ jamSplashWinner(data.payload); }, 2800);
            const w=data.payload&&data.payload.winner;
            var win=false;
            if(w && myName){
              if(String(w).toLowerCase()===String(myName).toLowerCase()) win=true;
              else if(typeof baseNick==='function' && baseNick(w).toLowerCase()===baseNick(myName).toLowerCase()) win=true;
            }
            if(win){ window.jamHud&&window.jamHud('I won — awarding piñata (via relayed result)'); jamAwardLegendaryPinata(); }
          }catch(e){}
        } else if(data.type==='tourneyLobby'){
          tourney.players=uniqRoster(data.players||[], myName);
          tourney.size=data.size||tourney.size;
          // v845: sync bot flags from host
          try{
            if(data.bots && data.bots.length){
              data.bots.forEach(function(b){ tourneyBots[b]=true; });
            }
          }catch(e){}
          try{ clampRosterToCap(); }catch(e){}
          renderBracket();
          try{ updateLobby(); }catch(e){}
          try{ applyLobbyCount(publicKind||tourney.size, roomCode||'', tourney.players.length, false); }catch(e){}
          try{ setJamBtnBadge(tourney.players.length); }catch(e){}
        } else if(data.type==='tourneyState'){
          if(data.tourney) tourney=data.tourney; renderBracket();
        } else if(data.type==='tourneyChamp'){
          setStatus('🏆 Champion: '+(data.champ||'?') );
          if(data.champ===(myName||'')) awardTournamentChampion(tourney.size);
          // new open lobbies after a finished bracket
          try{
            (async function(){
              try{ publishLobby(4, await pickOpenSlot(4)||'4PT1', 0, false); }catch(e){}
              try{ publishLobby(8, await pickOpenSlot(8)||'8PT1', 0, false); }catch(e){}
            })();
          }catch(e){}
        }
      }catch(e){}
    });
    c.on('close', ()=>{
      try{
        if(window.__jamConns){
          window.__jamConns=window.__jamConns.filter(function(x){ return x!==c && x && x.open; });
        }
      }catch(e){}
      // v793: host always stays in lobby when a peer drops — never showIdle
      if(isHost && roomCode){
        partnerReady=false;
        setLight(true);
        try{ broadcastLobbyCount(); }catch(e){}
        setStatus('Hosting '+roomCode+' — waiting for players…');
        if(conn===c) conn=(window.__jamConns&&window.__jamConns[0])||null;
        return;
      }
      if(!partnerReady){
        conn=null;
        return;
      }
      setStatus('Partner disconnected.');
      partnerReady=false; setLight(false);
      try{ stopHeartbeat(); }catch(e){}
      showIdle(); conn=null;
    });
    c.on('error', function(){
      try{ /* PeerJS will often follow with close */ }catch(e){}
    });
    c.on('error', (e)=>{ setStatus('Connection error: '+(e&&e.message||'')); });
  }

  function ensurePeer(id){
    return new Promise((resolve, reject)=>{
      if(typeof Peer==='undefined'){ reject(new Error('PeerJS failed to load — check your connection.')); return; }
      try{ if(peer){ try{ peer.destroy(); }catch(e){} peer=null; } }catch(e){}
      peer=new Peer(id);
      var settled=false;
      peer.on('open', function(){
        if(settled) return; settled=true;
        setStatus(id?'Connected to lobby mesh.':'Peer ready.');
        resolve(peer);
      });
      peer.on('error', function(e){
        var msg=(e&&(e.type||e.message||e))+'';
        // unavailable-id is expected when probing; for host seat it's fatal
        if(/unavailable-id|taken|already/i.test(msg)){
          if(!settled){ settled=true; reject(new Error('seat taken — try next')); }
          return;
        }
        setStatus('Error: '+msg);
        // network/server drop — soft message, do not tear lobby UI
        if(/network|server|disconnected|socket/i.test(msg)){
          setStatus('Signaling hiccup — lobby still open. Reconnecting…');
          return;
        }
        if(!settled){ settled=true; reject(e); }
      });
      peer.on('disconnected', function(){
        // PeerJS cloud blip — try reconnect without killing lobby
        try{
          setStatus('Reconnecting to signaling…');
          if(peer && !peer.destroyed) peer.reconnect();
        }catch(e){}
      });
    });
  }

  function genCode(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)]; return s; }

  function readNick(){ return (document.getElementById('jamNickInput').value||'').trim().slice(0,24); }
  // v788: unique display name = nick + seat (Matt-4PT1A) — no duplicate roster names
  // v792: strip any prior seat/lobby suffix so we never get Matt-4PT1A-4PT1B
  function baseNick(nick){
    var n=String(nick||'Player').trim();
    // strip seat/lobby tags WITH or WITHOUT hyphens (Matt4PT1A, Matt-4PT1A-4PT1B, etc.)
    for(var i=0;i<6;i++){
      var next=n.replace(/[-_]?((?:4|8)PT\d+[A-Ha-h]?|JAM\d+[A-Ha-h]?|VS\d+[A-Ha-h]?)/gi,'');
      if(next===n) break;
      n=next;
    }
    n=n.replace(/[^a-zA-Z0-9_]/g,'').slice(0,16);
    return n||'Player';
  }
  function seatTaggedName(nick, seat){
    const n=baseNick(nick);
    const s=String(seat||'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
    if(!s) return n;
    return (n+'-'+s).slice(0,28);
  }
  function extractSeat(name){
    const m=String(name||'').toUpperCase().match(/((?:4|8)PT\d+[A-H]|JAM\d+[A-B]|VS\d+[A-B])$/);
    return m?m[1]:'';
  }
  function uniqRoster(names, preferMe){
    // v798: each SEAT is a distinct player. Matt-4PT1A and Matt-4PT1B = 2 people.
    // Only collapse exact duplicates / double-tagged garbage.
    const by={}, order=[];
    (names||[]).forEach(function(raw){
      if(!raw) return;
      const b=baseNick(raw);
      const seat=extractSeat(raw);
      const clean=seat?(b+'-'+seat):b;
      const key=seat?(seat.toLowerCase()):('name:'+b.toLowerCase());
      if(!by[key]){ by[key]=clean; order.push(key); return; }
      if(preferMe && (raw===preferMe || clean===preferMe)) by[key]=clean;
    });
    return order.map(function(k){ return by[k]; });
  }
  function nickOkOrWarn(){
    const n=readNick();
    const warn=document.getElementById('jamNickWarn');
    if(window.isReservedNick && window.isReservedNick(n)){
      if(warn){ warn.style.display='block'; warn.textContent='Already in use'; }
      setStatus('Already in use');
      return false;
    }
    if(warn) warn.style.display='none';
    return true;
  }
  function readPw(){ return (document.getElementById('jamPwInput').value||'').trim().toUpperCase().replace(/[^A-Z0-9\-]/g,'').slice(0,24); }
  function setLight(connected){
    const l=document.getElementById('jamLight'); if(!l) return;
    l.style.background = connected ? '#22c55e' : '#dc2626';
    l.style.boxShadow = '0 0 6px '+(connected?'#22c55e':'#dc2626');
  }
  // v740: persist nickname + custom room password locally so re-hosting the same
  //   room later (or just reopening the app) doesn't require retyping them.
  try{
    const savedNick=localStorage.getItem('improvs2_jam_nick');
    const savedPw=localStorage.getItem('improvs2_jam_pw');
    if(savedNick){
      try{ savedNick=baseNick(savedNick); }catch(e){}
      document.getElementById('jamNickInput').value=savedNick;
    }
    if(savedPw) document.getElementById('jamPwInput').value=savedPw;
  }catch(e){}

  async function hostJam(){
    if(!nickOkOrWarn()) return;
    myName=readNick()||'Host';
    const customPw=readPw();
    try{ localStorage.setItem('improvs2_jam_nick', baseNick(myName||readNick()||'Player')); if(customPw) localStorage.setItem('improvs2_jam_pw', customPw); }catch(e){}
    isHost=true; roomCode=customPw||genCode();
    setStatus('Setting up room…');
    try{
      // v831: was ensurePeer() — zero settle window, zero tiebreaker. Private/password
      // lobbies share the exact same double-host race as the public JAM1-4 pools if two
      // people pick the same password (or a genCode() collision). Route through the
      // already-hardened claim path instead of duplicating the protection a third time.
      const got=await tryClaimSeatPeer(roomCode, true);
      if(!got || !got.peer){
        setStatus(got&&got.taken?('Room '+roomCode+' is already in use — try a different password.'):'Could not host: no response.');
        showIdle(); return;
      }
      peer=got.peer;
      setStatus('Waiting for someone to join with code '+roomCode+'…');
      showActive(roomCode); updateLobby();
      peer.on('connection', (c)=>{ wireConn(c); });
    }catch(e){ setStatus('Could not host: '+(e&&e.message||'')); showIdle(); }
  }

  async function joinJam(code){
    if(!nickOkOrWarn()) return;
    myName=readNick()||'Guest';
    try{ localStorage.setItem('improvs2_jam_nick', baseNick(myName||readNick()||'Player')); }catch(e){}
    isHost=false; roomCode=code;
    setStatus('Connecting to '+code+'…');
    try{
      await ensurePeer(null);
      const c=peer.connect('improvs2-jam-'+code, {reliable:true});
      c.on('open', ()=>{ wireConn(c); });
      c.on('error', (e)=>{ setStatus('Could not join: '+(e&&e.message||'')); });
    }catch(e){ setStatus('Could not join: '+(e&&e.message||'')); showIdle(); }
  }

  function leaveJam(){
    // v832: capture before nulling so we can announce leave on MQTT + board
    var _leaveCode=roomCode, _leaveSeat=mySeatCode, _leaveNick=myName, _leaveKind=publicKind;
    try{ if(conn) conn.close(); }catch(e){}
    try{ if(peer) peer.destroy(); }catch(e){}
    peer=null; conn=null; roomCode=null; partnerReady=false; pendingProposal=null;
    try{ if(_botFillTimer){ clearTimeout(_botFillTimer); _botFillTimer=null; } }catch(e){}
    try{ tourneyBots={}; }catch(e){}
    try{ stopTurnLight(); }catch(e){}
    try{ stopCountPulse(); }catch(e){}
    try{ stopHeartbeat(); }catch(e){}
    // announce 0 / reduced count before tearing down
    try{
      if(_leaveKind && _leaveCode){
        if(isHost){ partnerReady=false; publishLobby(_leaveKind, _leaveCode, 0, false); }
        else { publishLobby(_leaveKind, _leaveCode, Math.max(0, currentLobbyPlayers()-1), false); }
      }
    }catch(e){}
    try{
      if(window.MqttJam && _leaveCode){
        window.MqttJam.leaveLobby(_leaveCode, _leaveSeat, _leaveNick);
        if(isHost) window.MqttJam.publishCount(_leaveCode, 0, false);
      }
    }catch(e){}
    document.getElementById('jamChatLog').innerHTML='';
    document.getElementById('jamTrackVote').style.display='none';
    setLight(false);
    setStatus('Not connected.'); showIdle();
  }

  function sendChat(){
    const inp=document.getElementById('jamChatInput');
    const text=(inp.value||'').trim();
    if(!text) return;
    const hasPeer=(conn&&conn.open)||(window.__jamConns&&window.__jamConns.some(function(x){return x&&x.open;}));
    if(!hasPeer){ setStatus('Not connected.'); return; }
    const from=myName||'Player';
    jamSendAll({type:'chat', text:text, from:from});
    addChatLine('me', text);
    inp.value='';
  }

  // v739: propose/vote instead of unilaterally forcing a track — either side can suggest
  //   their currently-loaded track; the other side gets ACCEPT/DECLINE. Only on ACCEPT do
  //   we do the actual NinJam-style epoch-scheduled synchronized start.
  function proposeTrack(){
    const hasPeer=(conn&&conn.open)||(window.__jamConns&&window.__jamConns.some(function(c){return c&&c.open;}));
    if(!hasPeer){ setStatus('Not connected yet.'); return; }
    try{
      let bt=window.BackingTracks&&window.BackingTracks.getCurrentTrack?window.BackingTracks.getCurrentTrack():null;
      if(!bt) bt=window.__lastBkTrack||null;
      if(!bt || bt.id==null){
        setStatus('Load a backing track first (tap a pack face, then play it), then propose it.');
        return;
      }
      const _rawKey=String(bt.key||'C').trim();
      const _isMin=/min$/i.test(_rawKey) || /^[A-G](?:#|b)?m$/i.test(_rawKey) || bt.min===true;
      const payload={
        id: bt.id,
        title: bt.title||bt.name||'track',
        bpm: bt.bpm||120,
        key: _rawKey,
        min: _isMin,
        ts: bt.ts||'4/4',
        prog: bt.prog||null,
        audioUrl: bt.audioUrl||bt.audio||bt.url||null,
        seq: bt.seq||null,
        jamShare:true
      };
      pendingProposal=payload;
      // proposer counts as accept #1; one more accept starts
      window.__jamVote={accepts:1, names:[myName||'host'], track:payload};
      jamSendAll({type:'trackPropose', trackId:payload.id, title:payload.title, bpm:payload.bpm, track:payload, from:myName||'host'});
      setStatus('Proposed "'+payload.title+'" — 1/2 votes (you). Need 1 more accept.');
    }catch(e){ setStatus('Propose failed: '+(e&&e.message||'')); }
  }

  // v774: accepting a proposal = ready-up. Both sides run the same staged start.
  function jamSelectJimiWalk(track){
    // v775: JIMI walk is data-walk="seq". Meter comes from the track via startTrack — never force JH.
    try{
      const btn=document.querySelector('#metWalk [data-walk="seq"]');
      if(btn){
        try{ mWalkMode='seq'; mSeqIdx=0; }catch(e){}
        try{ document.querySelectorAll('#metWalk [data-walk]').forEach(function(x){ x.classList.toggle('active', x.dataset.walk==='seq'); }); }catch(e){}
        try{ btn.click(); }catch(e){}
        return 'seq';
      }
    }catch(e){}
    // only if the JIMI button is missing: random walk (not group)
    try{
      if(typeof window.__pickWalkForTrack==='function') return window.__pickWalkForTrack(track||null);
    }catch(e){}
    return null;
  }
  function jamReadyLayout(){
    try{
      // v845: fret chords OFF, 3STR (not 4STR), carousel OFF — all active panels
      // (time signature + walk are set when the track loads / jamSelectJimiWalk)
      ['sS_','sC_','sE_'].forEach(function(pref){
        try{
          if(window.__fourStrSet&&window.__fourStrSet[pref]) window.__fourStrSet[pref](false);
          if(window.__carSet&&window.__carSet[pref]) window.__carSet[pref](false);
          const fb=document.getElementById(pref+'btnFretChd');
          if(fb&&fb.classList.contains('active')) fb.click();
        }catch(e){}
      });
      // scroll fretboard to bottom of the app so 3-string view is in reach
      try{
        const board=document.querySelector('.shapes-area')||document.getElementById('sE_box1')||document.getElementById('sS_box1');
        if(board) board.scrollIntoView({behavior:'smooth', block:'end'});
        window.scrollTo({top:document.body.scrollHeight, behavior:'smooth'});
      }catch(e){}
    }catch(e){}
  }
  // v861-lite35: epoch-locked countdown — rush/drag so late devices catch up
  function jamEnsureOverlay(){
    let ci=document.getElementById('jamReadyOv');
    if(!ci){
      ci=document.createElement('div'); ci.id='jamReadyOv';
      ci.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(6,6,10,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Bangers,cursive;';
      document.body.appendChild(ci);
    }
    return ci;
  }
  function jamShowSyncWait(goEpoch){
    const ci=jamEnsureOverlay();
    ci.style.display='flex';
    function paint(){
      const left=Math.max(0, goEpoch - Date.now());
      const sec=Math.ceil(left/1000);
      ci.innerHTML='<div style="font-size:1.1em;color:#a78bfa;letter-spacing:0.18em;margin-bottom:10px;">SYNCING</div>'
        +'<div style="font-size:3.2em;color:#e2e8f0;text-shadow:0 0 24px #7c3aed66;">'+sec+'</div>'
        +'<div style="color:#64748b;font-size:0.75em;margin-top:12px;letter-spacing:0.12em;">BUFFER · LOADING TRACK</div>';
    }
    paint();
    if(ci._syncTimer) clearInterval(ci._syncTimer);
    ci._syncTimer=setInterval(paint, 200);
  }
  function jamCountInOverlay(n, done, goEpoch){
    // If goEpoch set: number shown is derived from wall clock (rush if late, wait if early)
    const ci=jamEnsureOverlay();
    try{ if(ci._syncTimer){ clearInterval(ci._syncTimer); ci._syncTimer=null; } }catch(e){}
    ci.style.display='flex';
    const IV=700;
    n=n||3;
    const epoch = (goEpoch!=null) ? (goEpoch|0) : (Date.now() + n*IV);
    let lastShown=-1;
    let finished=false;
    function finish(){
      if(finished) return;
      finished=true;
      try{ if(ci._tickTimer) clearTimeout(ci._tickTimer); }catch(e){}
      ci.style.display='none';
      try{ if(done) done(); }catch(e){}
    }
    function tick(){
      if(finished) return;
      const now=Date.now();
      const left=epoch - now;
      if(left<=40){
        ci.innerHTML='<div style="font-size:4.2em;color:#22c55e;text-shadow:0 0 28px #22c55e88;">GO</div>';
        try{ if(typeof metClick==='function') metClick(true); }catch(e){}
        ci._tickTimer=setTimeout(finish, Math.max(0, left+30));
        return;
      }
      // beats at epoch-n*IV … epoch-IV; number = ceil(left/IV) clamped 1..n
      var num=Math.ceil(left/IV);
      if(num>n) num=n;
      if(num<1) num=1;
      if(num!==lastShown){
        lastShown=num;
        ci.innerHTML='<div style="font-size:5em;color:'+(num<=1?'#22c55e':'#ffd700')+';text-shadow:0 4px 30px rgba(255,255,100,0.35);">'+num+'</div>'
          +'<div style="color:#9aa;font-size:0.85em;margin-top:12px;letter-spacing:0.14em;">GET READY</div>';
        try{ if(typeof metClick==='function') metClick(num===n); }catch(e){}
      }
      // poll frequently so a lagging device rushes through missed numbers
      const nextBoundary=epoch - (num-1)*IV;
      const delay=Math.max(30, Math.min(200, nextBoundary - Date.now()));
      ci._tickTimer=setTimeout(tick, delay);
    }
    tick();
  }

  function jamArmRecordNow(){
    // v839: MUST go through window.__armJamRec so the script-local `let recOn/recArr`
    //   (note capture) actually arm. Setting bare recOn here only touched a free global.
    try{
      if(typeof window.__armJamRec==='function'){
        window.__armJamRec();
      } else {
        console.warn('[JAM] __armJamRec missing — recorder not in scope');
      }
      try{ setStatus('● REC armed — play now'); }catch(e){}
    }catch(e){ console.warn('[JAM] arm record failed', e); }
  }
  window.__jamArmRecordNow=jamArmRecordNow;
  function jamStopRecordNow(){
    try{
      if(typeof window.__stopJamRec==='function') window.__stopJamRec();
    }catch(e){}
  }
  function jamBuildMyScore(){
    try{
      // Prefer live grade from this take — recompute if toast missing/stale
      let g=null;
      try{
        const t=document.getElementById('gradeToast');
        if(t && t._g && !t._g.vsEmpty) g=t._g;
      }catch(e){}
      // v861-lite30: read take + jam snapshot (recArr can look empty after stop races)
      var take=[];
      try{ take=(window.getRecArr&&window.getRecArr())||[]; }catch(e){ take=[]; }
      if((!take || !take.length) && window.__lastJamTake && window.__lastJamTake.length){
        take=window.__lastJamTake.slice();
      }
      if(!g && take.length>=1){
        try{
          if(typeof window.__gradeTake==='function') g=window.__gradeTake('recording');
          else {
            const fn=window.scoreCurrentTake;
            if(fn) g=fn('recording');
          }
        }catch(e){ console.warn('[JAM] grade', e); }
        try{ if(g){ g.vsEmpty=false; showGradeToast(g); } }catch(e){}
      }
      let score=0, grade='F';
      if(g && !g.vsEmpty){
        score=((window.JudgeWeights&&window.JudgeWeights.blend&&g._raw&&Object.keys(g._raw).length)
          ?window.JudgeWeights.blend(g._raw).score : g.score)|0;
        grade=(typeof _finalGrade==='function')?_finalGrade(g):(g.grade||'F');
      } else if(take.length>=1){
        // real notes played — never F/empty
        score=Math.min(72, 28+take.length*2);
        grade=score>=50?'C':(score>=35?'D':'D');
      }
      if(!take.length){ score=0; grade='F'; }
      else if(score<15){ score=Math.max(score, 15+Math.min(20,take.length)); grade=grade==='F'?'D':grade; }
      let rep='EMPTY';
      try{
        if(window.Replays && take.length){
          const enc=window.Replays.encode(take);
          if(enc) rep=enc;
        }
      }catch(e){}
      const bt=(window.BackingTracks&&window.BackingTracks.getCurrentTrack)?window.BackingTracks.getCurrentTrack():null;
      return {score:score|0, grade:grade||'F', nick:myName||'me', rep:rep, trackId:bt&&bt.id, notes:take.length|0};
    }catch(e){
      return {score:0, grade:'F', nick:myName||'me', rep:'EMPTY', trackId:null, notes:0};
    }
  }
  function jamSplashWinner(payload){
    try{
      let ov=document.getElementById('jamWinnerOv');
      if(!ov){
        ov=document.createElement('div'); ov.id='jamWinnerOv';
        ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(6,4,12,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Bangers,cursive;text-align:center;padding:20px;';
        document.body.appendChild(ov);
      }
      const rows=(payload.scores||[]).map(function(s){
        return '<div style="color:#cbd5e1;font-size:0.95em;margin:4px 0;">'+s.nick+': <b style="color:#fde68a;">'+s.score+'</b> ('+s.grade+')</div>';
      }).join('');
      ov.innerHTML='<div style="font-size:3.2em;color:#fbbf24;text-shadow:0 0 28px #f59e0b;">🏆 WINNER</div>'
        +'<div style="font-size:2em;color:#fff;margin:10px 0 6px;">'+(payload.winner||'?')+'</div>'
        +'<div style="color:#a78bfa;font-size:0.9em;margin-bottom:14px;">Legendary piñata awarded</div>'
        +'<div style="max-width:320px;margin:0 auto;">'+rows+'</div>'
        +'<button id="jamWinnerClose" style="margin-top:18px;padding:10px 22px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-weight:900;cursor:pointer;">OK</button>';
      ov.style.display='flex';
      const btn=document.getElementById('jamWinnerClose');
      if(btn) btn.onclick=function(){ ov.style.display='none'; };
      setTimeout(function(){ try{ ov.style.display='none'; }catch(e){} }, 12000);
    }catch(e){}
  }
  function jamAwardLegendaryPinata(){
    try{
      // only once per round
      if(window.__jamLootAwarded) return;
      window.__jamLootAwarded=true;
      var result=null;
      if(window.Loot && typeof window.Loot.grant==='function'){
        result=window.Loot.grant('legendary', 1);
      } else {
        // fallback write (reloads will pick it up)
        try{
          const raw=localStorage.getItem('improvs2_loot');
          const d=raw?JSON.parse(raw):{};
          d.inv=d.inv||{common:0,rare:0,epic:0,legendary:0};
          d.inv.legendary=(d.inv.legendary||0)+1;
          localStorage.setItem('improvs2_loot', JSON.stringify(d));
          result={tier:'legendary', count:d.inv.legendary};
        }catch(e){}
      }
      try{ if(window.Loot && window.Loot.render) window.Loot.render(); }catch(e){}
      try{ if(window.__refreshBonusBtn) window.__refreshBonusBtn(); }catch(e){}
      // toast confirmation
      try{
        const t=document.createElement('div');
        t.style.cssText='position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:100001;background:#1a1400;border:2px solid #f59e0b;border-radius:10px;padding:12px 18px;font-family:Bangers,cursive;font-size:1em;letter-spacing:1px;color:#fbbf24;text-align:center;box-shadow:0 4px 20px #000a;pointer-events:none;';
        t.textContent='🎁 LEGENDARY PIÑATA ×'+(result&&result.count?result.count:1)+' ADDED';
        document.body.appendChild(t);
        setTimeout(function(){ try{ t.remove(); }catch(e){} }, 4500);
      }catch(e){}
      // open pyramid so they can smash it
      try{ if(window.Loot && window.Loot.openPyramid) setTimeout(function(){ window.Loot.openPyramid(); }, 600); }catch(e){}
    }catch(e){ console.warn('[JAM] loot award failed', e); }
  }
  function jamMaybeResolveRound(){
    try{
      if(!window.__jamScores) return;
      // v845: host fills missing bot scores under best real so rounds always resolve
      try{ if(isHost) injectBotScores(); }catch(e){}
      const scores=window.__jamScores;
      const keys=Object.keys(scores);
      window.jamHud&&window.jamHud('scores in: '+keys.join(', ')+' ('+keys.length+' total)');
      // need at least 2 different players
      if(keys.length<2) return;
      const roster=(tourney.players&&tourney.players.length)?tourney.players:null;
      if(roster && roster.length>=2){
        const have=roster.filter(function(n){ return !!scores[n]; });
        // for 4p wait for all; for jam/vs 2 is enough even if roster incomplete
        if(roster.length>2 && have.length<roster.length){
          window.jamHud&&window.jamHud('waiting on '+(roster.length-have.length)+' more player(s) before resolving');
          // host: if only bots are missing, inject and continue next tick
          if(isHost){
            var missingBots=roster.filter(function(n){ return !scores[n] && isBotName(n); });
            var missingReal=roster.filter(function(n){ return !scores[n] && !isBotName(n); });
            if(missingReal.length===0 && missingBots.length>0){
              try{ injectBotScores(); }catch(e){}
              // fall through with updated scores
            } else {
              return;
            }
          } else {
            return;
          }
        }
      }
      const list=Object.keys(scores).map(function(k){ return scores[k]; });
      list.sort(function(a,b){ return (b.score|0)-(a.score|0); });
      const winner=list[0];
      window.jamHud&&window.jamHud('winner: '+winner.nick+' ('+winner.score+' · '+winner.grade+')');
      // v845: pairwise Elo among real players only
      try{ eloApplyLobbyScores(scores); }catch(e){}
      const payload={winner:winner.nick, scores:list};
      if(isHost) jamSendAll({type:'jamRoundResult', payload:payload});
      // v833: hold the judging panel on screen before the winner splash covers it
      // (both use z-index 100000; winner used to appear instantly and hide the panel)
      setTimeout(function(){ jamSplashWinner(payload); }, 2800);
      try{
        var win=false;
        if(myName && winner.nick){
          if(String(winner.nick).toLowerCase()===String(myName).toLowerCase()) win=true;
          else if(typeof baseNick==='function' && baseNick(winner.nick).toLowerCase()===baseNick(myName).toLowerCase()) win=true;
        }
        if(win){ window.jamHud&&window.jamHud('I won — awarding piñata'); jamAwardLegendaryPinata(); }
      }catch(e){}
      window.__jamRoundActive=false;
      window.__jamPlayOnce=false;
      setStatus('🏆 Winner: '+winner.nick+' ('+winner.score+' · '+winner.grade+')');
    }catch(e){}
  }
  function jamAutoSubmitScore(){
    try{
      const sc=jamBuildMyScore();
      vsMyScore=sc;
      if(!window.__jamScores) window.__jamScores={};
      window.__jamScores[sc.nick]=sc;
      jamSendAll({type:'vsScore', score:sc.score, grade:sc.grade, nick:sc.nick, rep:sc.rep, trackId:sc.trackId});
      setStatus('Grade locked: '+sc.score+' ('+sc.grade+') — waiting for others…');
      jamMaybeResolveRound();
      try{ maybeResolveVersus(); }catch(e){}
    }catch(e){}
  }
  window.__jamOnTrackEnded=function(){
    if(window.__jamEndedOnce) return;
    window.__jamEndedOnce=true;
    try{ window.__jamPlayOnce=false; }catch(e){}
    try{ if(window.BackingTracks&&window.BackingTracks.stopTrack) window.BackingTracks.stopTrack(); }catch(e){}
    // stop rec without count-in path, then grade locally for BOTH host and joiner
    // snapshot notes BEFORE stop (some paths clear/race the live array)
    try{
      var _pre=[];
      try{ _pre=(window.getRecArr&&window.getRecArr())||[]; }catch(e){}
      if(_pre && _pre.length) window.__lastJamTake=_pre.slice();
    }catch(e){}
    try{ jamStopRecordNow(); }catch(e){}
    try{
      let g=null;
      try{
        if(typeof window.__gradeTake==='function') g=window.__gradeTake('recording');
      }catch(e){ console.warn('[JAM] __gradeTake', e); }
      if(!g){
        var take=[];
        try{ take=(window.getRecArr&&window.getRecArr())||[]; }catch(e){}
        if((!take||!take.length) && window.__lastJamTake) take=window.__lastJamTake||[];
        try{ window.jamHud&&window.jamHud('track end notes='+take.length); }catch(e){}
        if(take.length>=1){
          try{ const fn=window.scoreCurrentTake; if(fn) g=fn('recording'); }catch(e){}
        }
        if(!g && take.length>=1) g={grade:'D', score:Math.min(72,28+take.length*2), aura:1, _raw:{}, vsEmpty:false};
        if(!g) g={grade:'F', score:0, aura:0, _raw:{}, vsEmpty:true};
        else g.vsEmpty=false;
        try{ showGradeToast(g); }catch(e){}
        try{ if(window.JudgePanel && !g.vsEmpty) window.JudgePanel.show(g); }catch(e){}
      }
    }catch(e){}
    // allow judging panel + toast to be seen, then both sides submit their own score
    // (was 1200ms — too short; panel never visibly appeared before jamSplashWinner)
    setTimeout(function(){ jamAutoSubmitScore(); }, 4500);
  };

  function startSharedTrack(track, startAtEpoch){
    if(!track || track.id==null){ setStatus('No track data to start.'); return; }
    // v797: proposer's unlocked track plays for everyone in the lobby
    window.__jamSharedUnlock=true;
    window.__jamPendingTrack=track;
    setJamBufferFromTrack(track);
    window._jamSyncEpoch=startAtEpoch;
    // close jam panel — ready-up takes over the main UI
    try{ const panel=document.getElementById('jamPanel'); if(panel) panel.style.display='none'; }catch(e){}
    jamReadyLayout();
    const wait=Math.max(0, (startAtEpoch||Date.now()) - Date.now());
    // 3-2-1 then start (or shorter if epoch is soon)
    const go=function(){
      // v812: 50/50 BK ↔ IMP balance at shared take start
      try{
        const bal=document.getElementById('mixBalanceSlider');
        if(bal){ bal.value='50'; bal.dispatchEvent(new Event('input')); }
        if(window.setBkVol) window.setBkVol(1);
        if(window.setInstVol) window.setInstVol(1);
      }catch(e){}
      window.__jamPlayOnce=true;
      window.__jamRoundActive=true;
      window.__jamEndedOnce=false;
      window.__jamLootAwarded=false;
      window.__jamScores={};
      // v816: arm record for ALL users FIRST — even if audio start fails
      try{ jamArmRecordNow(); }catch(e){}
      try{ if(window.BackingTracks && window.BackingTracks.stopTrack) window.BackingTracks.stopTrack(); }catch(e){}
      try{ window.BackingTracks.startTrack(track); }catch(e){ setStatus('startTrack failed: '+(e&&e.message||e)); }
      try{ jamSelectJimiWalk(track); }catch(e){}
      try{
        if(track.ts==='free'){
          if(track.seq && window.__setFreeSeq) window.__setFreeSeq(track.seq);
          if(window.__armFreePack) window.__armFreePack();
        }
      }catch(e){}
      // v861-lite31: BOTH clients start met on the SHARED epoch — no second local count-in
      //   (jam 3-2-1 overlay already aligned; metStart() alone desynced host vs joiner)
      try{
        // re-assert epoch for audio loader (startTrack may consume it asynchronously)
        if(startAtEpoch) window._jamSyncEpoch=startAtEpoch;
        if(track.bpm && window.__syncBpmAndStart){
          window.__syncBpmAndStart(track.bpm, { skipCountIn:true, atEpoch:startAtEpoch||null });
        } else if(window.__startMetNow){
          const d=Math.max(0, (startAtEpoch||Date.now())-Date.now());
          setTimeout(function(){ try{ window.__startMetNow(); }catch(e){} }, d);
        }
      }catch(e){ console.warn('[JAM] met sync', e); }
      // re-arm after startTrack (stopTrack can clear state)
      try{ jamArmRecordNow(); }catch(e){}
      setStatus('● REC — live take, grades lock when track ends');
      try{ startTurnLight(startAtEpoch||Date.now()); }catch(e){}
      // v779: scroll to fretboard AFTER countdown (layout scroll often ran while overlay was up)
      try{
        requestAnimationFrame(function(){
          try{
            const board=document.querySelector('.shapes-area')||document.getElementById('sE_box1')||document.getElementById('sS_box1');
            if(board) board.scrollIntoView({behavior:'smooth', block:'end'});
            else window.scrollTo({top:document.body.scrollHeight, behavior:'smooth'});
          }catch(e){}
          setTimeout(function(){
            try{ window.scrollTo({top:document.body.scrollHeight, behavior:'smooth'}); }catch(e){}
          }, 350);
        });
      }catch(e){}
    };
    // v861-lite35: 4s BUFFER (load) → then epoch-locked 3-2-1 → GO at startAtEpoch
    //   late devices RUSH (skip numbers); early devices wait — wall clock is source of truth
    const COUNT_MS=(typeof COUNTIN_MS==='number'?COUNTIN_MS:2100);
    const BUFFER_MS=(typeof HANDSHAKE_MS==='number'?HANDSHAKE_MS:4000);
    let goAt=startAtEpoch|| (Date.now()+BUFFER_MS+COUNT_MS);
    // if epoch is too soon (clock skew / late message), still use it — countdown will rush
    window._jamSyncEpoch=goAt;
    const countStart=goAt - COUNT_MS;
    const untilCount=countStart - Date.now();
    function beginCount(){
      try{ jamCountInOverlay(3, go, goAt); }catch(e){ try{ go(); }catch(e2){} }
    }
    if(untilCount > 80){
      try{ jamShowSyncWait(countStart); }catch(e){}
      setTimeout(beginCount, untilCount);
    } else if(goAt - Date.now() > 80){
      // already in countdown window — rush/drag from current wall time
      beginCount();
    } else {
      // GO overdue — start immediately
      try{ const ci=document.getElementById('jamReadyOv'); if(ci) ci.style.display='none'; }catch(e){}
      go();
    }
  }
  function voteOnTrack(accept){
    const v=document.getElementById('jamTrackVote');
    v.style.display='none';
    const msg=accept
      ? {type:'trackAccept', from:myName||'player'}
      : {type:'trackDecline', from:myName||'player'};
    jamSendAll(msg);
    // if we are host and tally runs on accept messages from others, also apply local accept for host proposing path
    if(accept && pendingProposal){
      // non-proposer accepted — host receives trackAccept via... we're the acceptor, host needs the message
      // jamSendAll already sends to host if we are joiner
      setStatus('Accepted — waiting for 2nd vote / start…');
    } else if(accept){
      setStatus('Accepted — waiting for shared start…');
    } else {
      setStatus('Declined track.');
    }
  }

  document.querySelectorAll('.jam-mode-btn').forEach(function(b){
    b.addEventListener('click', function(){ setJamMode(b.dataset.jmode); });
  });
  function lobbyPref(size){
    if(size===4) return '4'; if(size===8) return '8'; if(size==='jam') return 'J'; if(size==='vs') return 'V'; return '';
  }
  function lobbyCap(size){ return (size===4||size===8)?size:2; }
  // v773: fixed slot codes for 1v1 public jam/versus. No more per-device random
  // codes racing each other — every install picks from the SAME small set of
  // codes, so "the" open lobby is always one of these, and 1/2 means something.
  // v786: LOBBIES vs SEATS
  //   Lobbies (shown code / which room): 4PT1..4PT4  and  8PT1..8PT4
  //   Seats (presence ids inside a lobby): 4PT1A..4PT1D  /  8PT1A..8PT1H
  //   Host PeerJS id = first seat (4PT1A). UI still shows lobby code 4PT1.
  //   Count = how many of that lobby's seat ids are taken → real 1/4..4/4.
  var PUBLIC_SLOTS={
    jam:['JAM1','JAM2','JAM3','JAM4'],
    vs:['VS1','VS2','VS3','VS4'],
    4:['4PT1','4PT2','4PT3','4PT4'],
    8:['8PT1','8PT2','8PT3','8PT4']
  };
  var _slotState={};
  var mySeatCode=null;   // e.g. 4PT1B
  var myLobbyCode=null;  // e.g. 4PT1
  function slotsFor(size){ return PUBLIC_SLOTS[size]||null; }
  function isTourneySize(size){ return size===4||size===8; }
  // v789: jam/vs also use seats — JAM1A/JAM1B, VS1A/VS1B (names Matt-JAM1A etc.)
  function isSeatMode(size){ return size===4||size===8||size==='jam'||size==='vs'; }
  function seatsForLobby(lobby, size){
    var letters;
    if(size===8) letters=['A','B','C','D','E','F','G','H'];
    else if(size===4) letters=['A','B','C','D'];
    else letters=['A','B']; // jam / vs 1v1
    return letters.map(function(L){ return String(lobby)+L; });
  }
  function hostSeatForLobby(lobby, size){
    const seats=seatsForLobby(lobby, size);
    return seats[0]||null; // 4PT1A
  }
  function hostSeatFor(size){
    // legacy helper: open lobby's host seat
    const L=(myLobbyCode)||(slotsFor(size)||[])[0];
    return hostSeatForLobby(L, size);
  }
  // v794: atomic seat claim — keep the Peer on success (no check-then-claim race).
  // Ghost ids from probe destroy() were marking 4PT1 full → 4th player sent to 4PT2.
  var _seatFreeCache={};
  function seatIsFree(code){
    return new Promise(function(resolve){
      try{
        var hit=_seatFreeCache[code];
        if(hit && (Date.now()-hit.t)<3000){ resolve(!!hit.free); return; }
      }catch(e){}
      var done=false, temp=null;
      function fin(v, definitive){
        if(done) return; done=true;
        // v802: only cache definitive open/taken — timeout as free caused 0/4 for observers
        if(definitive){ try{ _seatFreeCache[code]={free:!!v, t:Date.now()}; }catch(e){} }
        try{ if(temp) temp.destroy(); }catch(e){}
        resolve(!!v);
      }
      // v844: 2200ms — PeerJS broker under 7–8 concurrent seat probes often needs >1.1s
      var t=setTimeout(function(){ fin(true, false); }, 2200);
      try{
        if(typeof Peer==='undefined'){ clearTimeout(t); fin(true, false); return; }
        temp=new Peer('improvs2-jam-'+code, {debug:0});
        temp.on('open', function(){ clearTimeout(t); fin(true, true); });
        temp.on('error', function(err){
          var msg=(err&&(err.type||err.message||err))+'';
          if(/unavailable-id|taken|already|unavailable/i.test(msg)){ clearTimeout(t); fin(false, true); }
        });
      }catch(e){ clearTimeout(t); fin(true, false); }
    });
  }
  // Try to TAKE a seat id. Resolves {code, peer} or null if taken.
  function tryClaimSeatPeer(code, isHostClaim){
    // v827: PeerJS's free public broker can, under load, let two Peer('...same-id')
    // calls both fire 'open' before it reconciles the conflict and sends the LOSER a
    // delayed 'unavailable-id' error. Resolving on the first 'open' with no grace
    // window let two genuinely different devices both believe they'd won the SAME
    // host seat — the exact "two hosts of JAM1" bug. Host-seat claims now wait a
    // short settle window after 'open' listening for that delayed conflict before
    // finalizing; non-host seat claims keep the old fast path (lower stakes, and a
    // slow join already gets caught downstream when it tries to connect to a dead host).
    return new Promise(function(resolve){
      var done=false, p=null, settling=false;
      function fin(val){ if(done) return; done=true; resolve(val); }
      // v844: 5500ms claim window — later seats (E–H) and near-full 8p need more time under load
      var t=setTimeout(function(){
        if(settling) return; // already past 'open', mid grace window — let that finish
        try{ if(p) p.destroy(); }catch(e){}
        fin(null); // timeout — NOT the same as taken
      }, 5500);
      try{
        if(typeof Peer==='undefined'){ clearTimeout(t); fin(null); return; }
        p=new Peer('improvs2-jam-'+code, {debug:0});
        p.on('open', function(){
          clearTimeout(t);
          if(!isHostClaim){
            try{ _seatFreeCache[code]={free:false,t:Date.now()}; }catch(e){} fin({code:code, peer:p}); return;
          }
          settling=true;
          var myNonce=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
          try{ window.jamHud&&window.jamHud('host seat '+code+' opened — writing claim, settling 2500ms…'); }catch(e){}
          // v828: write our claim nonce to dreamlo immediately, then wait out both the
          // PeerJS settle window AND a moment for the write to propagate, then read back.
          // dreamlo overwrites same-name entries, so if a rival device claimed after us,
          // reading back reveals THEIR nonce instead of ours — that's our second signal
          // that we lost the race, independent of whatever PeerJS's broker did or didn't tell us.
          try{ if(window.GlobalBoard&&window.GlobalBoard.claimHostSeat) window.GlobalBoard.claimHostSeat(code, myNonce); }catch(e){}
          // v832: also claim via MQTT retain (third independent authority)
          var mqttClaimP = null;
          try{
            if(window.MqttJam && window.MqttJam.claimHost){
              mqttClaimP = window.MqttJam.claimHost(code, myNonce, (typeof myName!=='undefined'?myName:''), code);
            }
          }catch(e){}
          // v844: longer settle under multi-device 8p load
          setTimeout(function(){
            if(done) return; // a PeerJS conflict error already resolved us as taken
            // v838: PeerJS still holding this id after settle = WE are host.
            //   MQTT/dreamlo rival alone must NOT destroy a live PeerJS id — that left
            //   BOTH devices abandoning A and sitting on B "waiting for host".
            var proceed=function(){
              if(done) return;
              try{ _seatFreeCache[code]={free:false,t:Date.now()}; }catch(e){}
              try{ window.jamHud&&window.jamHud('host seat '+code+' confirmed — PeerJS holds id'); }catch(e){}
              fin({code:code, peer:p});
            };
            try{ if(mqttClaimP) mqttClaimP.catch(function(){}); }catch(e){}
            proceed();
          }, 2500);
        });
        p.on('error', function(err){
          var msg=(err&&(err.type||err.message||err))+'';
          if(/unavailable-id|taken|already|unavailable/i.test(msg)){
            clearTimeout(t);
            try{ window.jamHud&&window.jamHud('host seat '+code+' conflict detected'+(settling?' during settle window':'')+' — backing off'); }catch(e){}
            try{ p.destroy(); }catch(e){}
            try{ _seatFreeCache[code]={free:false,t:Date.now()}; }catch(e){}
            fin({taken:true, code:code});
          }
        });
      }catch(e){ clearTimeout(t); fin(null); }
    });
  }
  async function countTakenSeatsInLobby(lobby, size){
    const seats=seatsForLobby(lobby, size);
    // v842: parallel probe; timeout-as-free is NOT definitive — if ALL look free
    //   but MQTT/presence says occupied, prefer presence. Also: unknown timeouts
    //   should not zero a lobby that was just full.
    const flags=await Promise.all(seats.map(function(s){ return seatIsFree(s); }));
    let n=0, known=0;
    for(let i=0;i<flags.length;i++){
      // seatIsFree true=free, false=taken. Timeouts return true (free) without
      // definitive flag in cache — check cache age.
      var hit=null;
      try{ hit=_seatFreeCache[seats[i]]; }catch(e){}
      if(hit && (Date.now()-hit.t)<3000){
        known++;
        if(!hit.free) n++;
      } else if(!flags[i]){
        known++; n++;
      }
    }
    // if we learned nothing definitive, try MQTT presence length
    if(known===0){
      try{
        if(window.MqttJam){
          const pres=window.MqttJam.getLobbyPresence(lobby)||[];
          if(pres.length) return Math.min(seats.length, pres.length);
          const mc=window.MqttJam.getLobbyCount(lobby)|0;
          if(mc>0) return Math.min(seats.length, mc);
        }
      }catch(e){}
    }
    return n;
  }
  async function countTakenSeats(size){
    const lobby=myLobbyCode||(slotsFor(size)||[])[0];
    return countTakenSeatsInLobby(lobby, size);
  }
  async function pickOpenLobby(size){
    // v843: partial fill always wins. Prefer published/MQTT count when probes under-count.
    const lobbies=slotsFor(size)||[];
    const cap=lobbyCap(size);
    let best=null, bestN=-1, firstEmpty=null;
    for(let i=0;i<lobbies.length;i++){
      const L=lobbies[i];
      let n=0;
      try{ n=await countTakenSeatsInLobby(L, size); }catch(e){ n=0; }
      try{
        const pub=publicLobbies[size];
        if(pub && pub.code===L && (pub.count|0)>n && !pub.sealed) n=pub.count|0;
      }catch(e){}
      try{
        if(window.MqttJam){
          const mc=window.MqttJam.getLobbyCount(L)|0;
          if(mc>n) n=mc;
          const pres=(window.MqttJam.getLobbyPresence(L)||[]).length;
          if(pres>n) n=pres;
        }
      }catch(e){}
      if(n>0 && n<cap && n>bestN){ best=L; bestN=n; }
      if(n===0 && firstEmpty==null) firstEmpty=L;
    }
    return best||firstEmpty||lobbies[0];
  }
  // Claim seats in strict order A → B → C → D (never skip B to D).
  // Retry once per seat to ride out PeerJS id-release lag.
  async function claimPresenceSeatInLobby(lobby, size, asHost){
    const seats=seatsForLobby(lobby, size);
    if(!seats.length) return null;
    // v844: 8p later seats (E–H) + near-full need many more retries & longer backoff
    for(let i=0;i<seats.length;i++){
      const isA=(i===0);
      let got=await tryClaimSeatPeer(seats[i], isA);
      if(got && got.peer) return got;
      if(got && got.taken) continue;
      const retries=(size===8)?8:(size===4)?5:3;
      for(let r=0;r<retries;r++){
        await new Promise(function(x){ setTimeout(x, 500+r*300); });
        got=await tryClaimSeatPeer(seats[i], isA);
        if(got && got.peer) return got;
        if(got && got.taken) break;
      }
    }
    return null;
  }
  async function pickOpenSlot(size){
    // jam/vs: first free 1v1 lobby code
    const slots=slotsFor(size); if(!slots) return null;
    if(isSeatMode(size)) return pickOpenLobby(size);
    const cap=2;
    slots.forEach(function(s){ if(!_slotState[s]) _slotState[s]={count:0,sealed:false}; });
    try{
      if(window.GlobalBoard&&GlobalBoard.fetchAll&&(!GlobalBoard.isConfigured||GlobalBoard.isConfigured())){
        const entries=await GlobalBoard.fetchAll();
        entries.forEach(function(e){
          if(!e.isLobby||!e.code) return;
          if(slots.indexOf(e.code)>=0) _slotState[e.code]={count:e.count|0, sealed:!!e.sealed};
        });
      }
    }catch(e){}
    for(let i=0;i<slots.length;i++){
      const st=_slotState[slots[i]]||{count:0,sealed:false};
      if(st.sealed) continue;
      if((st.count|0)<cap) return slots[i];
    }
    return slots[0];
  }
  async function joinPublicLobby(size, asSpec){
    if(!asSpec && !nickOkOrWarn()) return;
    // v799: instant UI feedback on JOIN
    var joinBtns=[];
    try{
      var ids={4:'lobby4Join',8:'lobby8Join',jam:'lobbyJamJoin',vs:'lobbyVsJoin'};
      var id=ids[size];
      if(id){
        var b=document.getElementById(id);
        if(b){ joinBtns.push(b); b.dataset._old=b.textContent; b.textContent=asSpec?'SPECTATING…':'JOINING…'; b.disabled=true; b.style.opacity='0.7'; }
      }
      setStatus(asSpec?'Spectating…':'Joining '+((size===4||size===8)?size+'PT':'')+' lobby…');
    }catch(e){}
    function restoreJoinBtns(){
      joinBtns.forEach(function(b){
        try{ b.textContent=b.dataset._old||'JOIN'; b.disabled=false; b.style.opacity=''; delete b.dataset._old; }catch(e){}
      });
    }
    try{
    myName=readNick()||(asSpec?'Spec':'Player');
    if(window.isReservedNick && window.isReservedNick(myName)){
      setStatus('Already in use'); return;
    }
    try{ localStorage.setItem('improvs2_jam_nick', baseNick(myName)); }catch(e){}
    isSpectator=!!asSpec;
    publicKind=size;
    if(size==='jam'){ jamMode='jam'; noteRelay=true; setJamMode('jam'); }
    else if(size==='vs'){ jamMode='versus'; noteRelay=false; setJamMode('versus'); }
    else { jamMode='tournament'; noteRelay=false; tourney.size=size; tourney.players=[]; tourney.active=false; setJamMode('tournament'); }

    const label=(size===4||size===8)?(size+'-player'):(size==='jam'?'public jam':'public versus');
    // v789: ALL public modes use lobby + seats
    //   jam: JAM1 + JAM1A/JAM1B  →  Matt-JAM1A
    //   vs:  VS1  + VS1A/VS1B   →  Matt-VS1A
    //   4p:  4PT1 + 4PT1A..D    →  Matt-4PT1A
    // Host peer id = first seat. UI room code = lobby.
    let code, seat, hostPeer;
    if(size==='jam' || size==='vs'){
      // v841: STICK to lobby 1 (JAM1/VS1). Only advance when a LIVE host fills it.
      //   Ghost A or host still settling must not bounce us to VS2/JAM2.
      const lobbies=slotsFor(size)||[];
      let lobby=null, claimed=null, asHostSeat=false;
      async function hostAnswers(hostSeatId, waitMs){
        return await new Promise(function(resolve){
          var tmp=null, done=false;
          function fin(v){ if(done) return; done=true; try{ if(tmp) tmp.destroy(); }catch(e){} resolve(!!v); }
          var to=setTimeout(function(){ fin(false); }, waitMs||3500);
          try{
            if(typeof Peer==='undefined'){ clearTimeout(to); fin(false); return; }
            tmp=new Peer(undefined, {debug:0});
            tmp.on('open', function(){
              try{
                var c=tmp.connect('improvs2-jam-'+hostSeatId, {reliable:true});
                c.on('open', function(){ clearTimeout(to); fin(true); });
                c.on('error', function(){});
              }catch(e){ clearTimeout(to); fin(false); }
            });
            tmp.on('error', function(){ clearTimeout(to); fin(false); });
          }catch(e){ clearTimeout(to); fin(false); }
        });
      }
      // Prefer first lobby hard — up to N attempts to claim A or join live host
      const prefer = lobbies[0] || (size==='vs'?'VS1':'JAM1');
      const preferSeat = hostSeatForLobby(prefer, size);
      for(let attempt=0; attempt<5 && !lobby; attempt++){
        let got=await tryClaimSeatPeer(preferSeat, true);
        if(got && got.peer){
          lobby=prefer; claimed=got; asHostSeat=true; break;
        }
        if(got && got.taken){
          // Wait longer on first attempts — host may still be in PeerJS settle window
          const alive=await hostAnswers(preferSeat, attempt===0?4000:2800);
          if(alive){ lobby=prefer; asHostSeat=false; break; }
          // Ghost holder — wait for id release then re-claim A on SAME lobby
          await new Promise(function(x){ setTimeout(x, 600+attempt*300); });
          continue;
        }
        // timeout / null — retry same seat
        await new Promise(function(x){ setTimeout(x, 400); });
      }
      // Only if lobby-1 is truly full with a live host we couldn't join, try later slots
      if(!lobby){
        for(let li=1;li<lobbies.length;li++){
          const L=lobbies[li];
          const hostSeat=hostSeatForLobby(L, size);
          let got=await tryClaimSeatPeer(hostSeat, true);
          if(got && got.peer){ lobby=L; claimed=got; asHostSeat=true; break; }
          if(got && got.taken){
            const alive=await hostAnswers(hostSeat, 2800);
            if(alive){ lobby=L; asHostSeat=false; break; }
          }
        }
      }
      if(!lobby){
        // last resort: host prefer seat even without a confirmed claim peer
        lobby=prefer; asHostSeat=true;
      }
      code=lobby;
      hostPeer=hostSeatForLobby(lobby, size);
      seat=asHostSeat?hostPeer:(lobby+'B');
      myLobbyCode=lobby;
      mySeatCode=seat;
      window.__claimedSeatPeer=claimed&&claimed.peer?claimed.peer:null;
      window.__jamJoinAsHost=!!asHostSeat;
      if(!asSpec) myName=seatTaggedName(readNick()||myName, seat);
      publicLobbies[size]={code:lobby, count:1, sealed:false};
      renderPublicLobbies();
    } else if(isSeatMode(size)){
      // v794: walk lobbies until we atomically claim a free seat (fills 4PT1 before 4PT2)
      const lobbies=slotsFor(size)||[];
      const cap=lobbyCap(size);
      let lobby=null, claimed=null, taken=0;
      if(asSpec){
        lobby=await pickOpenLobby(size);
        taken=await countTakenSeatsInLobby(lobby, size);
      } else {
        // v795: do NOT trust pre-counts (ghost probes). Try to claim a seat on
        // v843: fill 8PT1/4PT1 completely before ever touching PT2
        // Prefer pickOpenLobby result first, then hammer lobby 0, only then later slots
        const preferList=[];
        if(lobby) preferList.push(lobby);
        (slotsFor(size)||[]).forEach(function(L){ if(preferList.indexOf(L)<0) preferList.push(L); });
        for(let li=0;li<preferList.length;li++){
          const L=preferList[li];
          const got=await claimPresenceSeatInLobby(L, size, false);
          if(got && got.peer){
            lobby=L; claimed=got;
            try{ taken=await countTakenSeatsInLobby(L, size); }catch(e){ taken=1; }
            break;
          }
          // v844: partial lobby — hammer first lobby harder (esp. 8p near full)
          if(li===0){
            const extraN=(size===8)?5:(size===4)?3:2;
            for(let extra=0;extra<extraN && !claimed;extra++){
              await new Promise(function(x){ setTimeout(x, 700+extra*250); });
              const g2=await claimPresenceSeatInLobby(L, size, false);
              if(g2 && g2.peer){
                lobby=L; claimed=g2;
                try{ taken=await countTakenSeatsInLobby(L, size); }catch(e){ taken=1; }
                break;
              }
            }
          }
        }
        if(!claimed){
          // v805: claim timeouts look like "full". Retry first lobby host seat once more slowly.
          try{
            const L0=(slotsFor(size)||[])[0];
            if(L0){
              const hs=hostSeatForLobby(L0, size);
              await new Promise(function(r){ setTimeout(r, 500); });
              const got=await tryClaimSeatPeer(hs, true);
              if(got){ lobby=L0; claimed=got; taken=0; }
            }
          }catch(e){}
        }
        if(!claimed){
          setStatus(label+' — could not claim a seat (network busy). Tap JOIN again.');
          restoreJoinBtns(); return;
        }
      }
      seat=claimed?claimed.code:null;
      code=lobby;
      hostPeer=hostSeatForLobby(lobby, size);
      myLobbyCode=lobby;
      mySeatCode=seat;
      // keep claimed peer for ensure path
      window.__claimedSeatPeer=claimed?claimed.peer:null;
      if(seat && !asSpec) myName=seatTaggedName(readNick()||myName, seat);

      publicLobbies[size]={code:lobby, count:Math.min(cap,(taken|0)+(seat?1:0)), sealed:false};
      renderPublicLobbies();
    } else {
      code=await pickOpenSlot(size);
      seat=code;
      hostPeer=code;
      myLobbyCode=code;
      mySeatCode=code;
      publicLobbies[size]={code:code, count:0, sealed:false};
      renderPublicLobbies();
    }
    setStatus((asSpec?'Spectating':'Joining')+' '+label+' '+code+'…');
    (async function(){
      try{
        let hostId='improvs2-jam-'+hostPeer;
        if(isSeatMode(size) && seat){
          if(window.__claimedSeatPeer && !window.__claimedSeatPeer.destroyed){
            peer=window.__claimedSeatPeer;
            window.__claimedSeatPeer=null;
            // v835: host listens when we hold seat A
            if(seat===hostPeer || ((size==='jam'||size==='vs') && window.__jamJoinAsHost && seat===hostPeer))
              peer.on('connection', function(c2){ wireConn(c2); });
          } else {
            // v813: if this seat id is taken, walk to next free seat (B→C→D)
            // v831: was raw ensurePeer() here — unguarded for host seats reachable via
            // this fallback branch. Route through the same hardened claim as everywhere else.
            try{
              const gotHere=await tryClaimSeatPeer(seat, seat===hostPeer);
              if(gotHere && gotHere.peer){ peer=gotHere.peer; }
              else { throw new Error(gotHere&&gotHere.taken?'seat taken':'claim failed'); }
            }catch(e){
              const again=await claimPresenceSeatInLobby(code, size, false);
              if(again && again.peer){
                peer=again.peer;
                seat=again.code;
                mySeatCode=seat;
                myName=seatTaggedName(readNick()||myName, seat);
              } else {
                await ensurePeer(null);
              }
            }
            if(seat===hostPeer && peer) peer.on('connection', function(c2){ wireConn(c2); });
          }
        } else {
          await ensurePeer(null);
        }
        // claimed host seat → we are host
        // v835: jam/vs host peer = seat A (JAM1A), so seat===hostPeer works again.
        var amHostSeat = (isSeatMode(size) && seat && seat===hostPeer)
          || ((size==='jam'||size==='vs') && !!window.__jamJoinAsHost && peer && seat===hostPeer);
        if(amHostSeat){
          isHost=true; roomCode=code; publicKind=size;
          partnerReady=false; partnerName='';
          window.__jamJoinAsHost=false;
          if(isTourneySize(size)){
            tourney.players=[];
            if(!asSpec && myName) tourney.players=[myName];
            try{ renderBracket(); }catch(e){}
          }
          showActive(code); updateLobby();
          publishLobby(size, code, 1, false);
          try{ applyLobbyCount(size, code, 1, false); }catch(e){}
          try{ startCountPulse(); startPresencePulse(); }catch(e){}
          try{ if(peer) peer.on('connection', function(c2){ wireConn(c2); }); }catch(e){}
          setStatus('Hosting '+label+' '+code+' as '+(mySeatCode||seat||'A')+' — waiting…');
          restoreJoinBtns();
          return;
        }
        const c=peer.connect(hostId, {reliable:true});
        let opened=false;
        function onJoined(cc){
          opened=true; isHost=false; roomCode=code; wireConn(cc);
          try{ cc.send({type:'hello', name:myName, role:asSpec?'spec':'player', lobbySize:size, publicKind:size, seat:mySeatCode||''}); }catch(e){}
          if((size==='jam'||size==='vs') && !asSpec){
            try{ publishLobby(size, code, 2, true); }catch(e){}
          }
          if(isTourneySize(size) && !asSpec){
            try{ setTimeout(function(){ probeAllPublicCounts(); }, 400); }catch(e){}
          }
          setStatus('Connected — mode '+jamMode);
        }
        c.on('open', function(){ onJoined(c); });
        c.on('error', function(){});
        // v822: shared fallback — claim the host seat on this lobby and become host.
        // Used both when we were meant to be host and connect timed out, AND now also
        // automatically when a joiner's host seat proves unreachable after retries.
        async function becomeHostOnLobby(){
          try{
            if(peer){ try{ peer.destroy(); }catch(e){} peer=null; }
            let got=null;
            // v836: always try seat A first; jam/vs must host as A (never B as host).
            if(isSeatMode(size)){
              const hs=hostSeatForLobby(code, size);
              got=await tryClaimSeatPeer(hs, true);
              if(!got || !got.peer){
                // A still busy — for jam/vs do NOT fall through to B as "host"
                if(size==='jam'||size==='vs'){
                  // one more hard retry on A after short wait (ghost release)
                  await new Promise(function(x){ setTimeout(x, 600); });
                  got=await tryClaimSeatPeer(hs, true);
                } else {
                  got=await claimPresenceSeatInLobby(code, size, true);
                }
              }
            }
            if(!got || !got.peer){
              got=await tryClaimSeatPeer(hostPeer, true);
            }
            // v843: 4p/8p only walk when this lobby has NO free seats left.
            if(!got || !got.peer){
              let freeLeft=0;
              try{
                if(size===4||size===8){
                  const seats=seatsForLobby(code, size)||[];
                  for(let si=0;si<seats.length;si++){
                    if(await seatIsFree(seats[si])) freeLeft++;
                  }
                }
              }catch(e){}
              if((size===4||size===8) && freeLeft>0){
                window.jamHud&&window.jamHud(code+' still has '+freeLeft+' free seat(s) — stay');
                let gStay=await claimPresenceSeatInLobby(code, size, true);
                if(gStay && gStay.peer) got=gStay;
              }
            }
            if(!got || !got.peer){
              const slots=slotsFor(size)||[];
              const startIdx=slots.indexOf(code);
              for(let i=1;i<=slots.length && (!got||!got.peer);i++){
                const nextCode=slots[(startIdx>=0?startIdx+i:i)%slots.length];
                if(nextCode===code) break;
                const nextHostPeer=isSeatMode(size)?hostSeatForLobby(nextCode,size):nextCode;
                let g2=null;
                if(isSeatMode(size)){
                  g2=await tryClaimSeatPeer(nextHostPeer, true);
                  if(!g2 || !g2.peer) g2=await claimPresenceSeatInLobby(nextCode, size, true);
                } else {
                  g2=await tryClaimSeatPeer(nextHostPeer, true);
                }
                if(g2 && g2.peer){
                  got=g2; code=nextCode; hostId='improvs2-jam-'+nextHostPeer; hostPeer=nextHostPeer;
                  window.jamHud&&window.jamHud('current lobby full — walked to '+nextCode);
                  break;
                }
              }
            }
            if(!got || !got.peer){
              setStatus(label+' — all lobbies full. Tap JOIN to retry.');
              return false;
            }
            peer=got.peer;
            seat=got.code;
            mySeatCode=seat;
            // Host only if we actually hold seat A
            if(size==='jam'||size==='vs'||isSeatMode(size)){
              hostPeer=hostSeatForLobby(code, size);
              isHost=(seat===hostPeer);
            } else {
              isHost=(seat===hostPeer);
            }
            myLobbyCode=code;
            roomCode=code; publicKind=size;
            myName=seatTaggedName(readNick()||myName||'Host', seat);
            if(isHost){
              peer.on('connection', function(c2){ wireConn(c2); });
              showActive(code); updateLobby();
              if(isTourneySize(size)){
                tourney.players=[];
                if(!asSpec && myName) tourney.players=[myName];
                publishLobby(size, code, tourney.players.length||1, false);
              } else {
                publishLobby(size, code, 1, false);
              }
              try{ startCountPulse(); startPresencePulse(); }catch(e){}
              setStatus('Hosting '+label+' '+code+' as '+seat+' — waiting…');
              return true;
            } else {
              showActive(code); updateLobby();
              const c3=peer.connect(hostId, {reliable:true});
              c3.on('open', function(){ onJoined(c3); });
              setTimeout(function(){
                if(!opened) setStatus('Joined seat '+seat+' — waiting for host…');
              }, 1500);
              return true;
            }
          }catch(e){
            setStatus('Lobby failed: '+(e&&e.message||e)+' — tap JOIN to try next seat.');
            return false;
          }
        }
        // v844: 4p/8p much longer connect window + more retries (host busy at 7/8)
        setTimeout(async function(){
          if(opened) return;
          const iAmHostSeat = !seat || seat===hostPeer;
          if(!iAmHostSeat){
            const maxRetry=(size==='jam'||size==='vs')?2:(size===8)?14:10;
            const gapMs=(size==='jam'||size==='vs')?500:(size===8)?1200:1000;
            for(let r=0;r<maxRetry && !opened;r++){
              await new Promise(function(x){ setTimeout(x, gapMs); });
              if(opened) return;
              try{
                const c2=peer.connect(hostId, {reliable:true});
                c2.on('open', function(){ opened=true; onJoined(c2); });
              }catch(e){}
            }
            if(!opened){
              window.jamHud&&window.jamHud('host unreachable on '+code+' — takeover path');
              setStatus('No host answer on '+code+' — staying on this lobby…');
              try{ if(peer){ peer.destroy(); peer=null; } }catch(e){}
              await becomeHostOnLobby();
            }
            return;
          }
          window.jamHud&&window.jamHud('claiming host seat on '+code);
          await becomeHostOnLobby();
        }, (size==='jam'||size==='vs')?1800:(size===8)?14000:11000);
      }catch(e){ setStatus('Could not join lobby: '+(e&&e.message||e)); }
    })();
  
  }catch(eJoin){ try{ setStatus('Join failed: '+(eJoin&&eJoin.message||eJoin)); }catch(e){} }
  finally{ try{ restoreJoinBtns(); }catch(e){} }
}

  async function hostPublicLobby(size){
    if(!nickOkOrWarn()) return;
    myName=readNick()||'Host';
    try{ localStorage.setItem('improvs2_jam_nick', baseNick(myName||readNick()||'Player')); }catch(e){}
    publicKind=size;
    if(size==='jam'){ jamMode='jam'; noteRelay=true; setJamMode('jam'); }
    else { jamMode='versus'; noteRelay=false; setJamMode('versus'); }
    isHost=true; isSpectator=false;
    (async function(){
      try{
        // v841: host seat A on lobby 1; only leave VS1/JAM1 if a LIVE host is there
        const lobbies=slotsFor(size)||[];
        let lobby=null, claimed=null;
        async function _liveHost(hs){
          return await new Promise(function(resolve){
            var tmp=null, done=false;
            function fin(v){ if(done) return; done=true; try{ if(tmp) tmp.destroy(); }catch(e){} resolve(!!v); }
            var to=setTimeout(function(){ fin(false); }, 3000);
            try{
              tmp=new Peer(undefined,{debug:0});
              tmp.on('open', function(){
                try{
                  var c=tmp.connect('improvs2-jam-'+hs,{reliable:true});
                  c.on('open', function(){ clearTimeout(to); fin(true); });
                  c.on('error', function(){});
                }catch(e){ clearTimeout(to); fin(false); }
              });
              tmp.on('error', function(){ clearTimeout(to); fin(false); });
            }catch(e){ clearTimeout(to); fin(false); }
          });
        }
        // hammer lobby 1 seat A
        for(let attempt=0; attempt<5 && !claimed; attempt++){
          const L0=lobbies[0];
          if(!L0) break;
          const hs=hostSeatForLobby(L0, size);
          let got=await tryClaimSeatPeer(hs, true);
          if(got && got.peer){ lobby=L0; claimed=got; break; }
          if(got && got.taken){
            if(await _liveHost(hs)){
              setStatus(L0+' already has a live host — use JOIN PUBLIC.');
              return;
            }
            await new Promise(function(x){ setTimeout(x, 700+attempt*250); });
            continue; // ghost — retry same A
          }
          await new Promise(function(x){ setTimeout(x, 400); });
        }
        // only then try VS2/JAM2…
        if(!claimed){
          for(let i=1;i<lobbies.length;i++){
            const hs=hostSeatForLobby(lobbies[i], size);
            let got=await tryClaimSeatPeer(hs, true);
            if(got && got.peer){ lobby=lobbies[i]; claimed=got; break; }
            if(got && got.taken){
              if(await _liveHost(hs)) continue;
              await new Promise(function(x){ setTimeout(x, 500); });
              got=await tryClaimSeatPeer(hs, true);
              if(got && got.peer){ lobby=lobbies[i]; claimed=got; break; }
            }
          }
        }
        if(!lobby||!claimed||!claimed.peer){
          setStatus('No free public lobby — try JOIN or wait a moment.');
          return;
        }
        const seat=hostSeatForLobby(lobby, size); // JAM1A
        myLobbyCode=lobby;
        mySeatCode=seat;
        roomCode=lobby;
        myName=seatTaggedName(readNick()||myName, seat);
        peer=claimed.peer;
        peer.on('connection', function(c2){ wireConn(c2); });
        showActive(lobby); updateLobby(); setLight(true);
        publishLobby(size, lobby, 1, false);
        try{ applyLobbyCount(size, lobby, 1, false); }catch(e){}
        try{ startCountPulse(); startPresencePulse(); }catch(e){}
        setStatus('Hosting public '+(size==='jam'?'jam':'versus')+' '+lobby+' as '+seat+' — waiting for partner…');
        try{ setJamBtnBadge(Math.max(1, window.__jamLivePlayers|0)); }catch(e){}
      }catch(e){ setStatus('Host failed: '+(e&&e.message||e)); }
    })();
  }
  function rotatePublicIfFull(){
    // v780: public 1v1 full → seal THIS room on the board, open the next fixed slot at 0/2.
    // Current peer session keeps roomCode=old; only the public listing advances.
    try{
      if(!isHost || !publicKind || (publicKind!=='jam'&&publicKind!=='vs')) return;
      if(!partnerReady || !roomCode) return;
      const old=roomCode;
      const cap=2;
      // 1) seal the filled lobby (count stays visible as 2/2 sealed on that code)
      _slotState[old]={count:cap, sealed:true};
      try{
        if(window.GlobalBoard && GlobalBoard.isConfigured && GlobalBoard.isConfigured()
           && typeof GlobalBoard.publishLobby==='function'){
          GlobalBoard.publishLobby({size:publicKind, code:old, count:cap, sealed:true});
        }
      }catch(e){}
      // 2) open next fixed slot for new pairs (do not move our roomCode)
      (async function(){
        let next=null;
        try{ next=await pickOpenSlot(publicKind); }catch(e){}
        const slots=slotsFor(publicKind)||[];
        if(!next || next===old){
          const i=slots.indexOf(old);
          next=slots[(i>=0?i+1:0)%Math.max(slots.length,1)]||old;
        }
        if(next===old && slots.length>1) next=slots[(slots.indexOf(old)+1)%slots.length];
        _slotState[next]={count:0, sealed:false};
        publicLobbies[publicKind]={code:next, count:0, sealed:false};
        try{
          if(window.GlobalBoard && GlobalBoard.isConfigured && GlobalBoard.isConfigured()
             && typeof GlobalBoard.publishLobby==='function'){
            GlobalBoard.publishLobby({size:publicKind, code:next, count:0, sealed:false});
          }
        }catch(e){}
        renderPublicLobbies();
        setStatus('Lobby full (2/2 on '+old+'). New public code: '+next);
      })();
    }catch(e){}
  }
  function probeSlotCount(code, kind){
    // v784: silently try to claim the PeerJS id for this slot.
    //   success  → nobody hosting → 0 players (destroy the temp peer)
    //   id-taken → host is live  → at least 1/2 (or 1/N)
    return new Promise(function(resolve){
      var done=false;
      function finish(n){
        if(done) return; done=true;
        try{ if(temp){ temp.destroy(); } }catch(e){}
        resolve({code:code, kind:kind, players:n|0, sealed:false});
      }
      var temp=null;
      var t=setTimeout(function(){ finish(0); }, 900);
      try{
        if(typeof Peer==='undefined'){ clearTimeout(t); finish(0); return; }
        // Prefer the same id the real host uses: improvs2-jam-CODE
        temp=new Peer('improvs2-jam-'+code, {debug:0});
        temp.on('open', function(){
          // We got the id → slot was empty. Release it immediately.
          clearTimeout(t);
          finish(0);
        });
        temp.on('error', function(err){
          var msg=(err && (err.type||err.message||err))+'';
          // PeerJS: 'unavailable-id' / 'ID is taken' / peer-unavailable
          if(/unavailable-id|taken|already|unavailable/i.test(msg)){
            clearTimeout(t);
            finish(1); // someone is hosting this slot
          }
          // other errors: treat as unknown/empty
        });
      }catch(e){ clearTimeout(t); finish(0); }
    });
  }
  async function probeAllPublicCounts(){
    // v786: jam/vs → first taken lobby = 1/2
    // 4/8 → find open lobby, count that lobby's seats (4PT1A..D) → N/4
    const kinds=['jam','vs',4,8];
    for(let ki=0;ki<kinds.length;ki++){
      const kind=kinds[ki];
      const slots=slotsFor(kind)||[];
      if(!slots.length) continue;
      // anyone already in this room trusts roster over probes
      if(publicKind===kind && roomCode && (isHost || (tourney.players&&tourney.players.length>0) || mySeatCode)){
        const nLive=Math.max(currentLobbyPlayers(), (tourney.players&&tourney.players.length)|0);
        const capLive=(kind===4||kind===8)?(kind|0):2;
        applyLobbyCount(kind, roomCode, nLive, nLive>=capLive);
        continue;
      }
      if(kind==='jam'||kind==='vs'){
        // v806: 1v1 count = lobby peer id taken? 1 : 0 (host board may raise to 2)
        // v832: prefer MQTT retained count / presence when available
        const lobbies=slotsFor(kind)||[];
        let best=null, bestN=0, empty=null;
        for(let i=0;i<lobbies.length;i++){
          const L=lobbies[i];
          let nMqtt=0;
          try{
            if(window.MqttJam){
              await window.MqttJam.joinLobby(L);
              nMqtt = window.MqttJam.getLobbyCount(L)|0;
              if(!nMqtt) nMqtt = (window.MqttJam.getLobbyPresence(L)||[]).length;
            }
          }catch(e){}
          if(nMqtt>0){ best=L; bestN=Math.min(2,nMqtt); break; }
          const free=await seatIsFree(hostSeatForLobby(L, kind)); // probes improvs2-jam-JAM1A
          if(!free){ best=L; bestN=1; break; }
          if(empty==null) empty=L;
        }
        applyLobbyCount(kind, best||empty||lobbies[0], bestN, false);
        continue;
      }
      if(isSeatMode(kind)){
        const lobbies=slotsFor(kind)||[];
        const cap=lobbyCap(kind);
        let best=null, bestN=-1, empty=null;
        for(let i=0;i<lobbies.length;i++){
          const L=lobbies[i];
          let n=0;
          try{ n=await countTakenSeatsInLobby(L, kind); }catch(e){ n=0; }
          if(n>0 && n<cap && n>bestN){ best=L; bestN=n; }
          if(n===0 && empty==null) empty=L;
          if(n>0 && n<cap) break;
        }
        applyLobbyCount(kind, best||empty||lobbies[0], best!=null?bestN:0, false);
        continue;
      }
      applyLobbyCount(kind, slots[0], 0, false);
    }
  }
  async function manualRefreshLobbies(btn){
    try{
      if(btn){ btn.textContent='…'; btn.disabled=true; }
      try{ _seatFreeCache={}; }catch(e){} // force fresh probe
      try{ if(isHost && publicKind && roomCode) broadcastLobbyCount(); }catch(e){}
      try{ await refreshPublicLobbies(); }catch(e){}
      try{ await probeAllPublicCounts(); }catch(e){}
      // board may hold a higher live count from host broadcast
      try{
        if(window.GlobalBoard && GlobalBoard.fetchAll){
          var entries=await GlobalBoard.fetchAll();
          (entries||[]).forEach(function(e){
            if(!e||!e.isLobby) return;
            var k=e.lobbyKey||e.lobbySize;
            var c=e.count|0;
            var code=e.code||'';
            if(!code||c<=0) return;
            var cur=publicLobbies[k];
            if(!cur || (c>(cur.count|0))) applyLobbyCount(k, code, c, !!e.sealed);
          });
        }
      }catch(e){}
      try{ await refreshLivePop(); }catch(e){}
      try{ renderPublicLobbies(); }catch(e){}
      try{ setStatus('Lobby counts refreshed.'); }catch(e){}
    }catch(e){
      try{ setStatus('Refresh failed.'); }catch(e2){}
    }finally{
      if(btn){ btn.disabled=false; btn.textContent='↻'; }
    }
  }
  document.querySelectorAll('.lobby-refresh-btn').forEach(function(b){
    b.addEventListener('click', function(){ manualRefreshLobbies(b); });
  });
  function _on(id, fn){ var el=document.getElementById(id); if(el) el.addEventListener('click', fn); }
  _on('lobby4Join', function(){ joinPublicLobby(4,false); });
  _on('lobby8Join', function(){ joinPublicLobby(8,false); });
  _on('lobby4Spec', function(){ joinPublicLobby(4,true); });
  _on('lobby8Spec', function(){ joinPublicLobby(8,true); });
  _on('lobby4Copy', function(){ copyText((publicLobbies[4]&&publicLobbies[4].code)||'', this); });
  _on('lobby8Copy', function(){ copyText((publicLobbies[8]&&publicLobbies[8].code)||'', this); });
  _on('lobbyJamJoin', function(){ joinPublicLobby('jam', false); });
  _on('lobbyVsJoin', function(){ joinPublicLobby('vs', false); });
  _on('lobbyJamHost', function(){ hostPublicLobby('jam'); });
  _on('lobbyVsHost', function(){ hostPublicLobby('vs'); });
  _on('lobbyJamCopy', function(){ copyText((publicLobbies.jam&&publicLobbies.jam.code)||'', this); });
  _on('lobbyVsCopy', function(){ copyText((publicLobbies.vs&&publicLobbies.vs.code)||'', this); });
  const specReplayBtn=document.getElementById('jamSpecReplay');
  if(specReplayBtn) specReplayBtn.addEventListener('click', function(){
    const p=window.__specFocus; const rep=p&&tourney.replays&&tourney.replays[p];
    if(!rep){ setStatus('No replay for that player yet.'); return; }
    try{ if(window.Replays&&Replays.playCode){ Replays.playCode(rep, null); setStatus('Playing '+p+'\'s replay'); } }catch(e){}
  });
  document.querySelectorAll('.jam-tsz').forEach(function(b){
    b.addEventListener('click', function(){ try{ if(typeof setTourneySize==='function') setTourneySize(+b.dataset.tsz); }catch(e){} });
  });
  var _jvs=document.getElementById('jamVsSubmitScore');
  if(_jvs) _jvs.addEventListener('click', function(){
    try{
      // v762: score + replay mandatory. No notes → 0 / F + EMPTY replay (backing only).
      var _take=[];
      try{ _take=(window.getRecArr&&window.getRecArr())||[]; }catch(e){}
      if((!_take||!_take.length) && window.__lastJamTake) _take=window.__lastJamTake||[];
      const t=document.getElementById('gradeToast');
      let g=t&&t._g;
      // re-score from real take if toast was false-empty
      if((!g || g.vsEmpty) && _take && _take.length>=1){
        try{ const fn=window.scoreCurrentTake; if(fn) g=fn('recording'); }catch(e){}
      }
      let score=0, grade='F';
      if(g && !g.vsEmpty){
        score=((window.JudgeWeights&&window.JudgeWeights.blend&&g._raw&&Object.keys(g._raw).length)
          ?window.JudgeWeights.blend(g._raw).score : g.score)|0;
        grade=(typeof _finalGrade==='function')?_finalGrade(g):(g.grade||'F');
      } else if(_take && _take.length>=1){
        score=Math.min(72, 28+_take.length*2);
        grade=score>=50?'C':'D';
      }
      if(!_take || !_take.length){ score=0; grade='F'; }
      let rep='EMPTY';
      try{
        if(window.Replays && _take && _take.length){
          const enc=window.Replays.encode(_take);
          if(enc) rep=enc;
        }
      }catch(e){}
      const bt=(window.BackingTracks&&window.BackingTracks.getCurrentTrack)?window.BackingTracks.getCurrentTrack():null;
      const tid=bt&&bt.id;
      vsMyScore={score:score, grade:grade, nick:myName||'me', rep:rep, trackId:tid};
      try{ if(conn&&conn.open) conn.send({type:'vsScore', score:score, grade:grade, nick:myName||'me', rep:rep, trackId:tid}); }catch(e){}
      setStatus('Score + replay submitted: '+score+' ('+grade+')'+(rep==='EMPTY'?' · empty take':'')+' — waiting on partner…');
      maybeResolveVersus();
    }catch(e){ setStatus('Submit failed: '+(e&&e.message||e)); }
  });
  var _jts=document.getElementById('jamTourneyStart');
  if(_jts) _jts.addEventListener('click', function(){
    if(!isHost) return;
    tourney.players = tourney.players.length?tourney.players:[myName, partnerName].filter(Boolean);
    while(tourney.players.length<tourney.size){ /* wait */ break; }
    if(tourney.players.length<2){ setStatus('Need at least 2 players.'); return; }
    var n=tourney.players.length;
    if(n>=8) tourney.size=8; else if(n>=4) tourney.size=4; else tourney.size=2;
    tourney.bracket=buildBracket(tourney.players);
    tourney.round=0; tourney.matchIdx=0; tourney.active=true;
    renderBracket();
    try{ broadcastTourney({type:'tourneyState', tourney:tourney}); }catch(e){}
    setStatus('Tournament started — play your matches as versus duels.');
  });
  document.getElementById('jamCopyCode').addEventListener('click', function(){
    const code=(document.getElementById('jamRoomCode').textContent||'').trim() || roomCode || '';
    if(!code){ setStatus('No room code yet.'); return; }
    function ok(){ setStatus('Code copied: '+code); const b=document.getElementById('jamCopyCode'); if(b){ const t=b.textContent; b.textContent='✓ COPIED'; setTimeout(function(){ b.textContent=t; }, 1200); } }
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(code).then(ok).catch(function(){
          // fallback
          const ta=document.createElement('textarea'); ta.value=code; document.body.appendChild(ta); ta.select();
          try{ document.execCommand('copy'); ok(); }catch(e){ setStatus('Copy failed — code is '+code); }
          ta.remove();
        });
      } else {
        const ta=document.createElement('textarea'); ta.value=code; document.body.appendChild(ta); ta.select();
        try{ document.execCommand('copy'); ok(); }catch(e){ setStatus('Copy failed — code is '+code); }
        ta.remove();
      }
    }catch(e){ setStatus('Code: '+code); }
  });
  // v818: previously skipped entirely while jamPanel was open — exactly when the
  // player is watching the counter. Now refreshes faster while open, slower while closed.
  // v819: badge relies on ambient background polling to invite taps, so keep it running,
  // but at 60s instead of 20s — badge doesn't need to be second-accurate. Fast 4s loop
  // still kicks in only while the panel is actually open and being watched.
  function startJamLivePollOnce(){
    if(window.__jamLivePoll) return;
    window.__jamLivePoll=setInterval(function(){
      try{ refreshLivePop(); }catch(e){}
    }, 60000);
    window.__jamLivePollFast=setInterval(function(){
      try{
        var p=document.getElementById('jamPanel');
        if(p && p.style.display==='flex'){ refreshLivePop(); refreshPublicLobbies(); }
      }catch(e){}
    }, 4000);
    try{ refreshLivePop(); }catch(e){}
  }
  startJamLivePollOnce();
  document.getElementById('jamBtn').addEventListener('click', function(){
    var panel=document.getElementById('jamPanel');
    if(panel) panel.style.display='flex';
    try{ startJamLivePollOnce(); }catch(e){}
    try{ refreshPublicLobbies(); }catch(e){}
    try{ refreshLivePop(); }catch(e){}
    try{ startCountPulse(); }catch(e){}
  });
  document.getElementById('jamCloseBtn').addEventListener('click', function(){
    var panel=document.getElementById('jamPanel');
    if(panel) panel.style.display='none';
    try{ stopCountPulse(); }catch(e){}
  });
  document.getElementById('jamHostBtn').addEventListener('click', hostJam);
  document.getElementById('jamJoinBtn').addEventListener('click', ()=>{
    const v=(document.getElementById('jamCodeInput').value||'').trim().toUpperCase();
    if(v) joinJam(v);
  });
  document.getElementById('jamProposeBtn').addEventListener('click', proposeTrack);
  document.getElementById('jamTrackAccept').addEventListener('click', ()=>voteOnTrack(true));
  document.getElementById('jamTrackDecline').addEventListener('click', ()=>voteOnTrack(false));
  document.getElementById('jamChatSend').addEventListener('click', sendChat);
  document.getElementById('jamChatInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });
  document.getElementById('jamLeaveBtn').addEventListener('click', leaveJam);

  window.Jam={
    // legacy one-shot (kept for any external callers)
    onLocalNote:function(midi, vel){
      try{ if(noteRelay && conn && conn.open) conn.send({type:'note', m:midi, vel:vel}); }catch(e){}
    },
    // v744/v745: note-on returns an id; pair with onLocalNoteOff / pitch / bend
    onLocalNoteOn:function(midi, vel){
      const id=++noteSeq;
      try{ if(noteRelay && conn && conn.open) conn.send({type:'noteOn', id:id, m:midi, vel:vel}); }catch(e){}
      return id;
    },
    onLocalNoteOff:function(id, fast){
      try{ if(noteRelay && conn && conn.open && id!=null) conn.send({type:'noteOff', id:id, fast:!!fast}); }catch(e){}
    },
    onLocalPitch:function(id, midi, glide){
      try{ if(noteRelay && conn && conn.open && id!=null) conn.send({type:'pitch', id:id, m:midi, glide:!!glide}); }catch(e){}
    },
    onLocalBend:function(id, semis){
      // throttle: only send if bent ≥0.05 semis from last, or ≥40ms since last send
      try{
        if(!noteRelay || !conn || !conn.open || id==null) return;
        const now=performance.now();
        const prev=_lastBendSent[id];
        if(prev && Math.abs(prev.semis-semis)<0.05 && (now-prev.t)<40) return;
        _lastBendSent[id]={semis:semis, t:now};
        conn.send({type:'bend', id:id, semis:semis});
      }catch(e){}
    },
    onLocalHarm:function(midi, vel, str){
      try{ if(noteRelay && conn && conn.open) conn.send({type:'harm', m:midi, vel:vel, str:str}); }catch(e){}
    },
    getSession:function(){
      try{
        const active=!!(roomCode && (partnerReady || (conn&&conn.open) || (window.__jamConns&&window.__jamConns.some(function(x){return x&&x.open;})) || window.__jamRoundActive));
        return {active:active, myName:myName||'', partnerName:partnerName||'', roomCode:roomCode||'', isHost:!!isHost, mode:jamMode, noteRelay:!!noteRelay};
      }catch(e){ return {active:false,myName:'',partnerName:'',roomCode:'',isHost:false,mode:'jam',noteRelay:true}; }
    },
    isNoteRelay:function(){ return !!noteRelay; },
    // v845
    fillBots:function(force){ return fillBotsIfNeeded(!!force); },
    getElo:function(nick){ return getElo(nick||myName); },
    isBot:function(n){ return isBotName(n); }
  };
})();

window.registerModule('multiplayer', {
  version: MODULE_VERSION,
  isStub: false,
  Jam: window.Jam || null,
  MqttJam: window.MqttJam || null
});
console.log('[modules] multiplayer v' + MODULE_VERSION);
})();
