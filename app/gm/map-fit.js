/* gm/map-fit.js: the fallback steps for a map over the iPad’s cap (map.fit).
   Registered as a stub by RK01 of the room key build; filled by RK28. It is in the map-fit bundle (app/routes.js), fetched only while its setting is on.
   Until it is filled it defines its global and does nothing when called.
   Plain script, UMD: window.B68GmMapFit in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMapFit = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function nothing() { return null; }
  return { stub: true, create: nothing };
});
