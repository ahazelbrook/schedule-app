/* B68GmB29: the GM page's glue for two switches (suite bundle B29): ai.batch (record the night locally; gm/batch-record.js) and room.light (gm/light.js).
   The page keeps hook lines only: it calls menuSync() when it draws the bar, click(action) for a Menu button, scene(id) when the iPad's scene changes,
   and suffix() for the ON AIR pill. Every function does nothing while its switch is off: no recording, no request.

   host: { on(id) -> bool, toast(text, bad), $(sel) -> element, now(), fetch? , relay? (base url of the light relay), env? }
   The recorder is the browser's own (microphone, MediaRecorder) and the sink a folder the GM picks once (File System Access); nothing is uploaded. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmB29 = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function browserParts(W) {
    var stream = null, rec = null, chunks = [], dir = null;
    return {
      recorder: {
        start: function () {
          if (!W.navigator || !W.navigator.mediaDevices || typeof W.MediaRecorder !== 'function') throw new Error('This browser cannot record.');
          if (typeof W.showDirectoryPicker !== 'function') throw new Error('Saving to a folder needs Chrome or Edge on the laptop.');
          /* the folder is asked for here, inside the tap, because a picker cannot open later from a stop that has no tap behind it */
          return Promise.resolve(dir || W.showDirectoryPicker({ mode: 'readwrite' })).then(function (d) { dir = d; return W.navigator.mediaDevices.getUserMedia({ audio: true }); }).then(function (s) { stream = s; chunks = []; rec = new W.MediaRecorder(s); rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); }; rec.start(10000); });
        },
        stop: function () {
          return new Promise(function (res) {
            if (!rec) return res(null);
            rec.onstop = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); res(new W.Blob(chunks, { type: 'audio/webm' })); };
            rec.stop();
          });
        }
      },
      sink: {
        save: function (name, blob) {
          return Promise.resolve(dir).then(function (d) { if (!d) throw new Error('No folder was chosen.'); return d.getFileHandle(name, { create: true }); })
            .then(function (fh) { return fh.createWritable(); }).then(function (w) { return Promise.resolve(w.write(blob)).then(function () { return w.close(); }); });
        }
      }
    };
  }
  function create(host, W) {
    var Rec = W.B68GmBatchRec, Light = W.B68GmLight, ctl = null, light = null;
    function rec() {
      if (!ctl && Rec) { var p = browserParts(W); ctl = Rec.create({ recorder: p.recorder, sink: p.sink, enabled: function () { return host.on('ai.batch'); }, now: host.now }); }
      return ctl;
    }
    function lamp() {
      if (!light && Light) light = Light.create({ enabled: function () { return host.on('room.light'); }, fetch: host.fetch || (typeof W.fetch === 'function' ? W.fetch.bind(W) : null), base: host.relay });
      return light;
    }
    function line(id, text, title) { return '<button type="button" data-gm="b29" data-act="' + id + '" id="gm-menu-b29-' + id + '" title="' + title + '">' + text + '</button>'; }
    function menuSync() {
      var after = host.$('#gm-menu-preflight') || host.$('#gm-menu-settings') || host.$('#gm-menu-live');
      [['batch', host.on('ai.batch'), function () { var s = rec() && rec().state(); return line('batch', s && s.recording ? 'Stop recording the night' : 'Record the night (this laptop)', 'Records the table on this laptop only; it is never uploaded live. The ON AIR lamp shows it.'); }],
       ['alarm', host.on('room.light'), function () { return line('alarm', 'Light alarm (3 s)', 'Flashes the rim lights for 3 seconds through the light relay. The work light never changes.'); }]].forEach(function (x) {
        var b = host.$('#gm-menu-b29-' + x[0]);
        if (x[1] && after) { var html = x[2](); if (b) { if (b.outerHTML !== html) b.outerHTML = html; } else after.insertAdjacentHTML('afterend', html); }
        else if (!x[1] && b && b.parentNode) b.parentNode.removeChild(b);
      });
    }
    function click(act) {
      if (act === 'batch' && host.on('ai.batch')) {
        var c = rec(); if (!c) return;
        if (c.state().recording) c.stop().then(function (r) { host.toast(r ? 'Saved ' + r.name + ' on this laptop.' : 'Could not save the recording: ' + (c.state().error || 'unknown'), !r); host.changed && host.changed(); });
        else { Promise.resolve(c.start()).then(function (ok) { host.toast(ok ? 'Recording on this laptop only.' : 'Could not start: ' + (c.state().error || 'the switch is off'), !ok); host.changed && host.changed(); }); }
        host.changed && host.changed();
      } else if (act === 'alarm' && host.on('room.light')) { lamp().alarm().then(function (ok) { if (!ok) host.toast('The light relay did not answer.', true); }); }
    }
    return {
      menuSync: menuSync, click: click,
      scene: function (id) { var l = lamp(); return l ? l.follow(id) : Promise.resolve(false); },
      suffix: function () { return Rec && host.on('ai.batch') && ctl ? Rec.suffix(ctl.state()) : ''; }
    };
  }
  return { create: create, browserParts: browserParts };
});
