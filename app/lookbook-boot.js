/* The look book's loader (app/lookbook.html, suite F6). GM only: it asks /api/me and draws nothing for anyone else. The page is not linked from the
   app; the GM opens it by address. Its scripts are the `lookbook` bundle (app/routes.js): a later bundle that adds a show kind lists its
   renderer file there. This file is external (not inline) so the page stays clean under the report-only CSP (script-src 'self'). */
(function () {
  'use strict';
  var root = document.getElementById('lookbook');
  function denied() {
    root.textContent = '';
    var d = document.createElement('p'); d.className = 'lb-denied'; d.textContent = 'GM only.'; root.appendChild(d);
  }
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  fetch('api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me || me.role !== 'gm') return denied();
      return addScript('routes.js')
        .then(function () { return window.B68Load.need('lookbook'); })
        .then(function () { window.B68Lookbook.run(root); });
    })
    .catch(denied);
})();
