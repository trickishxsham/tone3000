// modules/core/core.js
// version: 4.9.8.860
// Shared helpers / integrity companion.
(function(){
'use strict';
var MODULE_VERSION = '4.9.8.860';


// Optional shared helpers. Critical path stays in shell.
window.__mod_core_ready = true;


window.registerModule('core', {
  version: MODULE_VERSION,
  isStub: false
});
console.log('[modules] core v' + MODULE_VERSION);
})();
