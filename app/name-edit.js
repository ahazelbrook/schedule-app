/* name-edit.js — "Change name" on the Home greeting (hosted build only). Pure helpers, no DOM, no storage: boot.js draws the
   html and wires the events; the check is checks/runtime/gm-page.test.mjs.

   window.B68NameEdit:
     available(W)            true when W.claude.profile.setName exists (runtime/cf.js; app/CONTRACT.md "Display name")
     html(st, name)          the line under the greeting. st = { open, busy, error, value }; name = the name shown now
     save(profile, value)    Promise<{ ok: true, name } | { ok: false, message, network? }>. '' or null clears the override
                             (the sign-in name comes back). The server decides what a valid name is; its message is shown as it is.
   The server's rule (functions/api/me.js): trimmed, 1-40 characters, no control characters, no < or >. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68NameEdit = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MAX = 40;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function available(W) { var p = W && W.claude && W.claude.profile; return !!(p && typeof p.setName === 'function'); }

  function html(st, name) {
    st = st || {};
    if (!st.open) {
      return '<p class="hm-name" id="homeName">' + (name ? '<span>Shown to the table as <b>' + esc(name) + '</b>.</span> ' : '<span>No name shown yet.</span> ') +
        '<button type="button" class="hm-link" data-nm="open">Change name</button></p>';
    }
    var busy = st.busy ? ' disabled' : '';
    return '<form class="hm-nameform" id="homeName" data-nm-form="name" novalidate>' +
      '<label class="hm-namelab" for="homeNameIn">Your name at the table</label>' +
      '<div class="hm-namerow"><input type="text" id="homeNameIn" maxlength="' + MAX + '" autocomplete="nickname" value="' + esc(st.value == null ? name || '' : st.value) + '" aria-describedby="homeNameErr"' + busy + '>' +
      '<button type="submit" class="btn primary sm" data-nm="save"' + busy + '>' + (st.busy ? 'Saving…' : 'Save') + '</button>' +
      '<button type="button" class="btn sm" data-nm="clear" title="Go back to the name you sign in with"' + busy + '>Clear</button>' +
      '<button type="button" class="btn sm" data-nm="cancel"' + busy + '>Cancel</button></div>' +
      '<p class="hm-nameerr" id="homeNameErr" role="alert">' + esc(st.error || '') + '</p></form>';
  }

  function save(profile, value) {
    if (!profile || typeof profile.setName !== 'function') return Promise.resolve({ ok: false, message: 'Changing your name is not available here.' });
    var v = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
    if (v.length > MAX) return Promise.resolve({ ok: false, message: 'Use ' + MAX + ' characters or fewer.' });
    return Promise.resolve().then(function () { return profile.setName(v === '' ? null : v); }).then(function (me) {
      return { ok: true, name: me && typeof me.name === 'string' ? me.name : v, cleared: v === '' };
    }, function (e) {
      if (e && e.network) return { ok: false, network: true, message: 'You are offline. Try again when the connection is back.' };
      if (e && e.status === 400) return { ok: false, message: (e && e.message) || 'That name is not allowed.' };
      return { ok: false, message: 'Could not save: ' + ((e && e.message) || 'unknown error') };
    });
  }
  return { available: available, html: html, save: save, MAX: MAX };
});
