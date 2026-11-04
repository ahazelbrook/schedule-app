/* B68GmBatchRec: optional local recording on the GM laptop (suite ticket A3, switch ai.batch). Pure state around two things the caller injects:
   a `recorder` ({ start(), stop() -> Promise<blob-like> }) and a `sink` ({ save(name, blob) -> Promise }, a folder on the laptop: gm-private). Nothing here
   touches the network, the clock (the caller passes `now`) or the document: a recording is never uploaded live. The ON AIR lamp shows it:
   suffix(st) gives the words the bar's pill appends (' · REC (local)'), chip(st) the Listening box's chip.

   API (also module.exports under Node)
     create(deps) -> ctl   deps: { recorder, sink, enabled() -> bool, now() -> ms }
     ctl.start() -> bool (or a Promise of it, when the recorder's start is async)   false when the switch is off, a recording runs, or there is no recorder
     ctl.stop() -> Promise<{ name, bytes } | null>   saves through the sink; a sink failure leaves state idle and reports the error in ctl.state().error
     ctl.state() -> { recording, startedAt, error, last }
     suffix(st) chip(st) fileName(ms) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmBatchRec = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fileName(ms) { var d = new Date(ms); return 'night-' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '.webm'; }
  function suffix(st) { return st && st.recording ? ' · <span id="gm-bar-rec">REC (local)</span>' : ''; }
  function chip(st) { return st && st.recording ? ' <span class="gm-stt-on" id="gm-rec" data-state="on" role="status">REC (local)</span>' : ''; }
  function create(deps) {
    var d = deps || {}, st = { recording: false, startedAt: 0, error: '', last: null };
    function on() { return typeof d.enabled === 'function' && d.enabled() === true; }
    return {
      start: function () {
        if (!on() || st.recording || !d.recorder || typeof d.recorder.start !== 'function') return false;
        function began() { st.recording = true; st.startedAt = typeof d.now === 'function' ? d.now() : 0; st.error = ''; return true; }
        function failed(e) { st.error = String(e && e.message || e); return false; }
        var r; try { r = d.recorder.start(); } catch (e) { return failed(e); }
        return r && typeof r.then === 'function' ? r.then(began, failed) : began();
      },
      stop: function () {
        if (!st.recording) return Promise.resolve(null);
        var at = st.startedAt; st.recording = false;
        return Promise.resolve().then(function () { return d.recorder.stop(); }).then(function (blob) {
          var name = fileName(at), bytes = blob && typeof blob.size === 'number' ? blob.size : 0;
          return Promise.resolve(d.sink.save(name, blob)).then(function () { st.last = { name: name, bytes: bytes }; return st.last; });
        }).catch(function (e) { st.error = String(e && e.message || e); return null; });
      },
      state: function () { return { recording: st.recording, startedAt: st.startedAt, error: st.error, last: st.last }; }
    };
  }
  return { create: create, suffix: suffix, chip: chip, fileName: fileName };
});
