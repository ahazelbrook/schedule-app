/* gm/quick-rules.js: quick rules (gm.glance).
   Registered as a stub by RK01 of the room key build; filled by RK22. It is in the gm-glance bundle (app/routes.js), fetched only while its setting is on.
   Until it is filled it defines its global and does nothing when called.
   Plain script, UMD: window.B68GmQuickRules in the browser, module.exports under Node. ES5, as the files beside it. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmQuickRules = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function nothing() { return null; }
  return { stub: true, create: nothing };
});
