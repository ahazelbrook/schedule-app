/* gm/phone.js — the ringing phone (suite ticket 4.7, switch room.phone).

   When a `ring` beat goes up on the iPad (the show contract's ring kind), the practical speaker rings. On the GM's tap ("Answer") it plays a pre-recorded
   line, and the line's caption goes up on the iPad (the same ring beat, with the caption as its text). The recordings are the GM's own voice files, chosen
   from disk with a file picker and kept in IndexedDB on THIS laptop only: never uploaded, never put in the pack, never precached, never in git
   (gm-private/ is where the originals live). Nothing here goes to a phone.

   Window.B68GmPhone, and module.exports under Node.

   PURE
     cleanCaption(s) -> a caption the ring beat will take (60 characters, one line) or ''
     lineOf(meta) -> { id, label, caption, ms } | null
   memStore() -> a store for tests and for a browser with no IndexedDB:  { list(), get(id), put(id, meta, blob), del(id) }  (all promises)
   idbStore(win) -> the same over IndexedDB (database b68-gm-phone), or null
   make(host) -> ctl
     host: { on(): bool, speaker: { play(src, { loop }) -> { stop(), done } }, show(kind, payload, opts) -> Promise, store, toast(msg, bad?), root?(), now?() }
     ctl.onShow(kind, payload)  call for every show the page sends: a ring starts the ringer (ignored while answering, and while off)
     ctl.ringing() -> bool      ctl.hangup()      ctl.answer(lineId) -> Promise<bool>      ctl.ring(text?) -> Promise  (the GM's own Ring button)
     ctl.add(file, label, caption) -> Promise<line>      ctl.remove(id)      ctl.lines() -> Promise<[line]>
     ctl.open() ctl.toggle() ctl.render(box) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmPhone = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var CAP_MAX = 60, MS_MIN = 1000, MS_MAX = 60000, RING_CAP_MS = 45000;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cleanCaption(s) { var t = str(s).replace(/\s+/g, ' ').trim(); return t.length > CAP_MAX ? t.slice(0, CAP_MAX - 1).trim() + '…' : t; }
  function lineOf(m) {
    if (!isObj(m) || !/^[A-Za-z0-9_-]{1,40}$/.test(str(m.id))) return null;
    var ms = typeof m.ms === 'number' && isFinite(m.ms) ? Math.max(MS_MIN, Math.min(MS_MAX, Math.round(m.ms))) : 8000;
    return { id: m.id, label: str(m.label).trim().slice(0, 60) || 'Line', caption: cleanCaption(m.caption), ms: ms };
  }

  function memStore() {
    var m = {};
    return {
      list: function () { return Promise.resolve(Object.keys(m).map(function (k) { return m[k].meta; })); },
      get: function (id) { return Promise.resolve(m[id] || null); },
      put: function (id, meta, blob) { m[id] = { meta: meta, blob: blob }; return Promise.resolve(true); },
      del: function (id) { delete m[id]; return Promise.resolve(true); }
    };
  }
  function idbStore(win) {
    var idb = win && win.indexedDB; if (!idb) return null;
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        var rq = idb.open('b68-gm-phone', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('lines'); };
        rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
      });
      return dbp;
    }
    function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('lines', mode), rq = fn(t.objectStore('lines')); t.oncomplete = function () { res(rq && rq.result); }; t.onerror = function () { rej(t.error); }; }); }); }
    return {
      list: function () { return tx('readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).map(function (r) { return r.meta; }); }); },
      get: function (id) { return tx('readonly', function (s) { return s.get(id); }).then(function (r) { return r || null; }); },
      put: function (id, meta, blob) { return tx('readwrite', function (s) { return s.put({ meta: meta, blob: blob }, id); }).then(function () { return true; }); },
      del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }).then(function () { return true; }); }
    };
  }

  function make(host) {
    var h = host || {}, ctl = {}, ringer = null, busy = false, n = 0, timer = null;
    var store = h.store || memStore();
    function on() { return typeof h.on === 'function' ? !!h.on() : true; }
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    function wav() { var P = W && W.B68GmPractical ? W.B68GmPractical : (typeof require === 'function' ? tryReq() : null); return P ? P.ringWav(3) : null; }
    function tryReq() { try { return require('./practical.js'); } catch (e) { return null; } }
    function clock() { return typeof h.now === 'function' ? h.now() : Date.now(); }

    function startRing() {
      if (ringer || !h.speaker) return;
      var w = wav(); if (!w) return;
      ringer = h.speaker.play(w, { loop: true });
      timer = typeof h.later === 'function' ? h.later(function () { ctl.hangup(); }, RING_CAP_MS) : null;
    }
    ctl.ringing = function () { return !!ringer; };
    ctl.hangup = function () {
      if (ringer) { ringer.stop(); ringer = null; }
      if (timer && typeof h.cancel === 'function') h.cancel(timer); timer = null;
    };
    /* every show the page sends passes through here: only a ring, only while the switch is on, and never the ring this module sends itself */
    ctl.onShow = function (kind) { if (kind === 'ring' && !busy && on()) startRing(); };
    ctl.ring = function (text) {
      var c = cleanCaption(text), p = c ? { text: c } : {};
      return Promise.resolve(h.show('ring', p, { key: 'ring-' + clock() + '-' + (++n) }));
    };
    ctl.lines = function () { return store.list().then(function (a) { return a.map(lineOf).filter(Boolean); }); };
    ctl.add = function (file, label, caption) {
      var id = 'l' + clock().toString(36) + (++n);
      var dur = file && typeof file.duration === 'number' ? file.duration * 1000 : 8000;
      var meta = lineOf({ id: id, label: label || (file && file.name) || 'Line', caption: caption, ms: dur });
      return store.put(id, meta, file).then(function () { return meta; });
    };
    ctl.remove = function (id) { return store.del(str(id)); };

    /* answer: stop the ringer, play the recording on the practical speaker, and put its caption on the iPad for as long as it plays */
    ctl.answer = function (lineId) {
      if (!on()) return Promise.resolve(false);
      return store.get(str(lineId)).then(function (rec) {
        var line = rec ? lineOf(rec.meta) : null;
        if (!line) { say('That recording is not on this laptop. Add it again from gm-private.', true); return false; }
        ctl.hangup(); busy = true;
        var pr = h.speaker ? h.speaker.play(rec.blob, { loop: false }) : null;
        var shown = line.caption ? Promise.resolve(h.show('ring', { text: line.caption }, { ms: line.ms, key: 'ans-' + line.id + '-' + clock() })) : Promise.resolve(null);
        return shown.catch(function () { say('The caption did not reach the iPad.', true); }).then(function () { busy = false; return true; });
      });
    };

    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'phone', 'Ringing phone') : null; }
    ctl.render = function (box) {
      if (!box) return Promise.resolve();
      return ctl.lines().then(function (ls) {
        var html = '<p class="gm-dim">The iPad shows a ringing phone; the practical speaker rings. Tap a line to answer: it plays here and its caption goes up on the iPad. Recordings stay on this laptop.</p>' +
          '<div class="gm-sb-row"><label>Caption: <input type="text" data-ph-cap maxlength="60" placeholder="optional, shown on the iPad"></label> <button type="button" class="btn sm primary" data-ph="ring">Ring</button> ' +
          '<button type="button" class="btn sm" data-ph="hangup"' + (ringer ? '' : ' disabled') + '>Hang up</button></div>' +
          (ls.length ? ls.map(function (l) { return '<div class="gm-sb-row"><b>' + esc(l.label) + '</b> <span class="gm-dim">' + esc(l.caption) + '</span> <button type="button" class="btn sm" data-ph-ans="' + esc(l.id) + '">Answer with this</button> ' +
            '<button type="button" class="btn sm" data-ph-del="' + esc(l.id) + '" aria-label="Remove ' + esc(l.label) + '">Remove</button></div>'; }).join('') : '<p class="gm-empty">No recordings yet.</p>') +
          '<div class="gm-sb-row"><label>Add a recording: <input type="file" accept="audio/*" data-ph-file></label> <label>Caption: <input type="text" data-ph-newcap maxlength="60"></label></div>';
        box.innerHTML = html;
        var sh = box.parentNode;
        if (sh && !sh.__ph) {
          sh.__ph = true;
          sh.addEventListener('click', function (ev) {
            var t = ev.target && ev.target.closest ? ev.target.closest('[data-ph],[data-ph-ans],[data-ph-del]') : null; if (!t) return;
            var cap = sh.querySelector('[data-ph-cap]');
            if (t.hasAttribute('data-ph-ans')) ctl.answer(t.getAttribute('data-ph-ans'));
            else if (t.hasAttribute('data-ph-del')) ctl.remove(t.getAttribute('data-ph-del')).then(function () { ctl.render(box); });
            else if (t.getAttribute('data-ph') === 'ring') ctl.ring(cap ? cap.value : '').then(function () { ctl.render(box); });
            else if (t.getAttribute('data-ph') === 'hangup') { ctl.hangup(); ctl.render(box); }
          });
          sh.addEventListener('change', function (ev) {
            var t = ev.target; if (!t || !t.hasAttribute || !t.hasAttribute('data-ph-file') || !t.files || !t.files[0]) return;
            var f = t.files[0], cap = sh.querySelector('[data-ph-newcap]');
            ctl.add(f, f.name.replace(/\.[^.]+$/, ''), cap ? cap.value : '').then(function () { ctl.render(box); }, function () { say('Could not keep that recording.', true); });
          });
        }
      });
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, memStore: memStore, idbStore: idbStore, cleanCaption: cleanCaption, lineOf: lineOf, CAP_MAX: CAP_MAX };
});
