/* B68GmB29: the GM page's glue for two switches (suite bundle B29): ai.batch (record the night locally; gm/batch-record.js) and room.light (gm/light.js).
   The page keeps hook lines only: it calls click(action), scene(id) when the iPad's scene changes, and suffix() for the ON AIR pill. Every function does nothing
   while its switch is off: no recording, no request.
   N2: the two Menu lines are gone. Both are tools with a small panel each, reached through B68GmTools.get('record') and .get('light'):
     tool(which) -> { open(), close(), render(box) }     which: 'record' | 'light'. open() draws the panel into the tool's sheet (Workshop.sheet(host.root(), id)), which
     is the right-edge sheet or, once the shell binds it inline, a container. Record the night: Start / Stop, on this laptop only. Light relay: whether the relay
     answers (one GET /state each time the panel is opened and each time Refresh is pressed; never on a timer; no answer reads "not answering") and Light alarm (3 s).

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
    /* ---- the two panels (N2) ---- */
    function Ws() { return W.B68GmWorkshop || null; }
    function elOf(box, tag, cls, text) { var e = box.ownerDocument.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    var recBox = null;         /* the record panel last drawn: it follows Start / Stop */
    function redraw() { if (recBox && recBox.isConnected) renderRecord(recBox); }
    var relayState = '';       /* '' not asked yet | 'up' | 'down' | 'asking' */
    var relaySeq = 0, lightBox = null;     /* the latest question wins; its answer redraws the light panel last drawn */
    function renderRecord(box) {
      box.textContent = '';
      var st = rec() && rec().state(), on = host.on('ai.batch');
      box.appendChild(elOf(box, 'p', 'gm-dim', 'Records the table on this laptop only. The file goes to a folder you choose once; it is never uploaded.'));
      var row = elOf(box, 'div', 'gm-sb-row');
      var left = elOf(box, 'span', '', st && st.recording ? 'Recording on this laptop' : 'Not recording');
      row.appendChild(left);
      var b = elOf(box, 'button', 'btn sm' + (st && st.recording ? '' : ' primary'), st && st.recording ? 'Stop' : 'Start');
      b.type = 'button'; b.setAttribute('data-b29-rec', st && st.recording ? 'stop' : 'start'); if (!on || !rec()) b.disabled = true;
      b.addEventListener('click', function () { click('batch'); });
      row.appendChild(b);
      box.appendChild(row);
      if (st && st.last) box.appendChild(elOf(box, 'p', 'gm-dim', 'Last saved: ' + st.last.name + ' (' + Math.round(st.last.bytes / 1024) + ' KB).'));
      if (st && st.error) box.appendChild(elOf(box, 'p', 'gm-warn', st.error));
      if (!on) box.appendChild(elOf(box, 'p', 'gm-empty', 'Recording is not available on this page.'));
    }
    function renderLight(box) {
      box.textContent = '';
      var on = host.on('room.light');
      box.appendChild(elOf(box, 'p', 'gm-dim', 'The strip follows the iPad scene; the alarm flashes the rim lights for 3 seconds. The work light never changes.'));
      var row = elOf(box, 'div', 'gm-sb-row');
      var said = elOf(box, 'span', '', relayState === 'up' ? 'Light relay: answering' : relayState === 'down' ? 'Light relay: not answering' : relayState === 'asking' ? 'Light relay: asking' : 'Light relay: not checked yet');
      said.setAttribute('data-b29-relay', relayState || 'unknown');
      row.appendChild(said);
      var rf = elOf(box, 'button', 'btn sm', 'Refresh'); rf.type = 'button'; rf.setAttribute('data-b29-refresh', '1');
      rf.addEventListener('click', function () { probe(box); });
      row.appendChild(rf);
      box.appendChild(row);
      var al = elOf(box, 'button', 'btn sm primary', 'Light alarm (3 s)'); al.type = 'button'; al.setAttribute('data-b29-alarm', '1'); if (!on || !lamp()) al.disabled = true;
      al.addEventListener('click', function () { click('alarm'); });
      box.appendChild(al);
    }
    /* one GET /state to the relay: a relay that is not running, or a refusal, reads "not answering" (calmly: no toast, no warning) */
    function probe(box) {
      if (box) lightBox = box;
      var f = host.fetch || (typeof W.fetch === 'function' ? W.fetch.bind(W) : null), n = ++relaySeq;
      if (!f || !host.on('room.light')) { relayState = 'down'; if (lightBox) renderLight(lightBox); return; }
      relayState = 'asking'; if (lightBox) renderLight(lightBox);
      Promise.resolve().then(function () { return f(String(host.relay || 'http://127.0.0.1:9300') + '/state'); }).then(function (r) { return !!(r && r.ok); }, function () { return false; })
        .then(function (ok) { if (n !== relaySeq) return; relayState = ok ? 'up' : 'down'; if (lightBox && lightBox.isConnected) renderLight(lightBox); });
    }
    function tool(which) {
      var id = which === 'light' ? 'light' : 'record', title = id === 'light' ? 'Light relay' : 'Record the night';
      function sh() { var w = Ws(), r = typeof host.root === 'function' ? host.root() : null; return w && r ? w.sheet(r, id, title) : null; }
      function draw(box) { if (id === 'light') { lightBox = box; renderLight(box); } else { recBox = box; renderRecord(box); } }
      return {
        render: draw,
        /* opening the light panel asks the relay once (no timer), so it never says "not checked yet" to a GM who has not pressed Refresh */
        open: function () { var s = sh(); if (!s) return false; draw(s.body); s.open(); if (id === 'light') probe(s.body); return true; },
        close: function () { var s = sh(); if (s) s.close(); }
      };
    }
    function click(act) {
      if (act === 'batch' && host.on('ai.batch')) {
        var c = rec(); if (!c) return;
        if (c.state().recording) c.stop().then(function (r) { host.toast(r ? 'Saved ' + r.name + ' on this laptop.' : 'Could not save the recording: ' + (c.state().error || 'unknown'), !r); host.changed && host.changed(); redraw(); });
        else { Promise.resolve(c.start()).then(function (ok) { host.toast(ok ? 'Recording on this laptop only.' : 'Could not start: ' + (c.state().error || 'the switch is off'), !ok); host.changed && host.changed(); redraw(); }); }
        host.changed && host.changed();
      } else if (act === 'alarm' && host.on('room.light')) { lamp().alarm().then(function (ok) { if (!ok) host.toast('The light relay did not answer.', true); }); }
    }
    return {
      tool: tool, click: click,
      scene: function (id) { var l = lamp(); return l ? l.follow(id) : Promise.resolve(false); },
      suffix: function () { return Rec && host.on('ai.batch') && ctl ? Rec.suffix(ctl.state()) : ''; }
    };
  }
  return { create: create, browserParts: browserParts };
});
