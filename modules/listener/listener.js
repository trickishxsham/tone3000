// modules/listener/listener.js — 4.9.8.861-lite42
(function(){
"use strict";
var MODULE_VERSION = "4.9.8.861-lite42";
window.IMPROVS_KEY_POOLS = {
  myMaj: [0,2,4,5,6,7,8,9,10,11],
  myMin: [0,1,2,3,5,7,8,9,10,11],
  blues: [0,2,3,4,5,6,7,9,10,11],
  classical: [0,2,3,4,5,7,8,9,10,11]
};
window.ImprovsKeyListener = {
  version: MODULE_VERSION,
  pools: window.IMPROVS_KEY_POOLS,
  poolPcs: function(root, style, maj){
    var p = window.IMPROVS_KEY_POOLS;
    var rel = style==="blues" ? p.blues : style==="classical" ? p.classical : (maj?p.myMaj:p.myMin);
    return rel.map(function(x){ return (x+root)%12; });
  }
};
try{ window.registerModule && window.registerModule("listener", { version: MODULE_VERSION, isStub: false }); }catch(e){}
console.log("[modules] listener v" + MODULE_VERSION);
})();
