// modules/lotus/lotus.js
// version: 4.9.8.860
// Lotus is a mode inside ScaleHive — loading lotus loads hive.
(function(){
  'use strict';
  var MODULE_VERSION = '4.9.8.860';
  function done(){
    window.registerModule('lotus', { version: MODULE_VERSION, isStub: false, via: 'hive' });
    console.log('[modules] lotus v' + MODULE_VERSION + ' (via hive)');
  }
  if(window.__MODULES && window.__MODULES.hive){ done(); return; }
  if(typeof window.loadModule === 'function'){
    window.loadModule('hive').then(done).catch(function(e){
      console.warn('[lotus] hive load failed', e);
      window.registerModule('lotus', { version: MODULE_VERSION, isStub: true, error: String(e) });
    });
  } else {
    done();
  }
})();
