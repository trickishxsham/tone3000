// modules/listener/listener.js — 4.9.8.861-lite51
(function(){
"use strict";
var MODULE_VERSION = "4.9.8.861-lite51";
// most major → most minor
window.IMPROVS_KEY_POOLS = {
  myMaj: [0,2,4,5,6,7,8,9,10,11],      // TRiCkiSh Major
  blues: [0,2,3,4,5,6,7,9,10,11],
  classical: [0,2,3,4,5,7,8,9,10,11],
  myMin: [0,1,2,3,5,7,8,9,10,11],      // ShAM Minor
  jazz: [0,1,2,3,4,5,7,8,10,11]        // most minor
};
window.IMPROVS_STYLE_LABELS = {
  myMaj: "TRiCkiSh Major",
  blues: "Blues",
  classical: "Classical",
  myMin: "ShAM Minor",
  jazz: "Jazz"
};
window.IMPROVS_STYLE_ORDER = ["myMaj","blues","classical","myMin","jazz"];
window.ImprovsKeyListener = {
  version: MODULE_VERSION,
  pools: window.IMPROVS_KEY_POOLS,
  labels: window.IMPROVS_STYLE_LABELS,
  order: window.IMPROVS_STYLE_ORDER,
  poolPcs: function(root, style){
    var p = window.IMPROVS_KEY_POOLS;
    var rel = p[style] || p.myMaj;
    return rel.map(function(x){ return (x+root)%12; });
  }
};
try{ window.registerModule && window.registerModule("listener", { version: MODULE_VERSION, isStub: false }); }catch(e){}
console.log("[modules] listener v" + MODULE_VERSION);
})();
