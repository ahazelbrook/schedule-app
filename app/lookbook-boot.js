/* The look book's loader (app/lookbook.html, suite F6). GM only: it asks /api/me and draws nothing for anyone else. The page is not linked from the
   app; the GM opens it by address. Its scripts are the `lookbook` bundle (app/routes.js): a later bundle that adds a show kind lists its
   renderer file there; the kit's look book files are the `kit-lookbook` bundle. This file is external (not inline) so the page stays clean under the report-only CSP (script-src 'self'). */
(function () {
  'use strict';
  var root = document.getElementById('lookbook');
  function denied() {
    root.textContent = '';
    var d = document.createElement('p'); d.className = 'lb-denied'; d.textContent = 'GM only.'; root.appendChild(d);
  }
  /* the kit and stage build: the UI kit and the new stage's files (the kit-lookbook bundle, routes.js), with every kit's token on this
     page's <html> (this page has no kit flag: it shows every kit). A kit that fails to load leaves the look book as it was */
  function kit() {
    return window.B68Load.need('kit-lookbook').then(function () { document.documentElement.setAttribute('data-kit', 'desk stage phone'); }, function () {});
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
        .then(kit)
        .then(function () { window.B68Lookbook.run(root); });
    })
    .catch(denied);
})();
