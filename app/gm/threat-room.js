/* gm/threat-room.js: the threat marker follows the roll (night.flow).
   Registered as a stub by RK01 of the room key build; filled by RK05. It is in the night-flow bundle (app/routes.js), fetched only while its setting is on.
   Until it is filled it defines its global and does nothing when called.
   Plain script, UMD: window.B68GmThreatRoom in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmThreatRoom = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function nothing() { return null; }
  return { stub: true, create: nothing };
});
