/* display/room-intro.js: the room opening's card on the iPad (room.intro).
   Registered as a stub by RK30 (the late registrar) of the room key build; filled by RK29. It is in the room-intro bundle (app/routes.js), fetched only while its setting is on.
   Until it is filled it defines its global and does nothing when called.
   Plain script, UMD: window.B68RoomIntro in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68RoomIntro = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function nothing() { return null; }
  return { stub: true, create: nothing, attach: nothing };
});
