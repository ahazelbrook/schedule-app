/* gm/practical.js — the practical-source speaker (suite ticket 4.5, switch room.practical).

   In-world sounds (a radio, a PA, a tape, a phone) go to a SECOND audio output chosen here, so they come from a small speaker on the sideboard instead of
   the laptop. On the GM laptop in Chrome or Edge. It uses HTMLAudioElement.setSinkId, guarded: where it is missing, or the device is gone, or the browser
   refuses, the sound plays on the default output and a one-line note says so. Nothing here is sent to the server, the iPad or a phone.

   Window.B68GmPractical, and module.exports under Node.

   PURE
     ringWav(secs?) -> Uint8Array      a plain two-tone phone ring as a 8 kHz mono WAV (made here: no file, no network)
     deviceList(raw) -> [{ id, label }]      the audio outputs from enumerateDevices(), unnamed ones numbered
   make(host) -> ctl
     host: { audio(): an audio-like { src, loop, play(), pause(), setSinkId?(id) }, devices(): Promise<[MediaDeviceInfo-like]>, url(blobOrBytes) -> string, revoke(url),
             store: { get(), set(v) }, toast(msg, bad?), on?(): bool, root?(): the page root (for the sheet) }
     ctl.supported() -> bool            setSinkId exists on this browser's audio element
     ctl.sink() -> the saved device id ('' = default)         ctl.setSink(id) -> Promise<bool>        ctl.refresh() -> Promise<[{id,label}]>
     ctl.play(src, { loop }) -> { stop(), done: Promise }      src: a blob, bytes or a URL string; plays on the chosen output
     ctl.test() -> the handle of a short ring          ctl.stopAll()
     ctl.open() ctl.toggle() ctl.render(box)  the sheet: output chooser and Test */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmPractical = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KEY = 'b68.gm.practical.sink';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* a two-tone ring: 440 + 480 Hz for 0.4 s, a short gap, twice, then a longer pause; 8-bit unsigned PCM keeps it small */
  function ringWav(secs) {
    var rate = 8000, n = Math.max(1, Math.round(rate * (secs > 0 && secs <= 10 ? secs : 3))), data = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / rate, cyc = t % 3, on = (cyc < 0.4) || (cyc >= 0.6 && cyc < 1.0), v = 128;
      if (on) v = 128 + Math.round(60 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) / 2);
      data[i] = v;
    }
    var out = new Uint8Array(44 + n), dv = new DataView(out.buffer);
    function s4(o, s) { for (var k = 0; k < 4; k++) out[o + k] = s.charCodeAt(k); }
    s4(0, 'RIFF'); dv.setUint32(4, 36 + n, true); s4(8, 'WAVE'); s4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); s4(36, 'data'); dv.setUint32(40, n, true);
    out.set(data, 44);
    return out;
  }
  function deviceList(raw) {
    var out = [], n = 0;
    (Array.isArray(raw) ? raw : []).forEach(function (d) {
      if (!isObj(d) || d.kind !== 'audiooutput' || !str(d.deviceId) || d.deviceId === 'default' || d.deviceId === 'communications') return;
      n++; out.push({ id: str(d.deviceId), label: str(d.label).trim().slice(0, 80) || 'Output ' + n });
    });
    return out;
  }

  function make(host) {
    var h = host || {}, ctl = {}, live = [], list = [], note = '';
    var store = h.store || { get: function () { return ''; }, set: function () {} };
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    function mk() { return typeof h.audio === 'function' ? h.audio() : null; }
    ctl.supported = function () { var a = mk(); return !!a && typeof a.setSinkId === 'function'; };
    ctl.sink = function () { return str(store.get()); };
    ctl.note = function () { return note; };
    ctl.setSink = function (id) {
      id = str(id);
      if (id && !ctl.supported()) { note = 'This browser cannot choose an output (use Chrome or Edge on the laptop): sounds play on the default output.'; say(note, true); return Promise.resolve(false); }
      store.set(id); note = ''; return Promise.resolve(true);
    };
    ctl.refresh = function () {
      if (typeof h.devices !== 'function') { list = []; return Promise.resolve(list); }
      return Promise.resolve().then(function () { return h.devices(); }).then(function (raw) { list = deviceList(raw); return list; }, function () { list = []; return list; });
    };
    ctl.devices = function () { return list.slice(); };

    /* play(src): on the chosen output; any failure to reach it falls back to the default output with a note, never a silent sound or an exception */
    ctl.play = function (src, o) {
      var a = mk(), url = '', made = false, fin, done = new Promise(function (r) { fin = r; }), stopped = false;
      var hd = { done: done, stop: function () { if (stopped) return; stopped = true; try { if (a) a.pause(); } catch (e) {} if (made && typeof h.revoke === 'function') h.revoke(url); live = live.filter(function (x) { return x !== hd; }); fin(); } };
      if (!a) { fin(); return hd; }
      if (typeof src === 'string') url = src; else if (typeof h.url === 'function') { url = h.url(src); made = true; }
      a.src = url; a.loop = !!(o && o.loop);
      if (typeof a.addEventListener === 'function') a.addEventListener('ended', function () { hd.stop(); });
      live.push(hd);
      var id = ctl.sink();
      var route = id && typeof a.setSinkId === 'function' ? Promise.resolve().then(function () { return a.setSinkId(id); }).catch(function () {
        note = 'The chosen speaker is not available: playing on the default output.'; say(note, true);
      }) : Promise.resolve();
      route.then(function () { return stopped ? null : a.play(); }).catch(function () { say('The sound could not play (the browser may need a tap first).', true); hd.stop(); });
      return hd;
    };
    ctl.test = function () { return ctl.play(ringWav(1.2), { loop: false }); };
    ctl.stopAll = function () { live.slice().forEach(function (x) { x.stop(); }); };

    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'practical', 'Practical speaker') : null; }
    ctl.html = function () {
      var cur = ctl.sink(), h2 = '<p class="gm-dim">In-world sounds (radio, PA, tape, phone) play on a second output. Pick the small speaker, then Test.</p>';
      if (!ctl.supported()) h2 += '<p class="gm-empty">This browser cannot choose an output. ' + 'Use Chrome or Edge on the laptop; sounds play on the default output.</p>';
      h2 += '<div class="gm-sb-row"><label>Output: <select data-pq="sink"><option value="">Default output</option>' +
        list.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></label> ' +
        '<button type="button" class="btn sm" data-pq="refresh">Find speakers</button> ' + '<button type="button" class="btn sm primary" data-pq="test">Test</button> <button type="button" class="btn sm" data-pq="stop">Stop</button></div>';
      if (note) h2 += '<p class="gm-dim" role="status">' + esc(note) + '</p>';
      return h2;
    };
    ctl.render = function (box) {
      if (!box) return;
      box.innerHTML = ctl.html();
      var sh = box.parentNode;
      if (sh && !sh.__pq) {
        sh.__pq = true;
        sh.addEventListener('change', function (ev) { var t = ev.target; if (t && t.getAttribute && t.getAttribute('data-pq') === 'sink') ctl.setSink(t.value).then(function () { ctl.render(box); }); });
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-pq]') : null; if (!t || t.tagName === 'SELECT') return;
          var a = t.getAttribute('data-pq');
          if (a === 'test') ctl.test(); else if (a === 'stop') ctl.stopAll(); else if (a === 'refresh') ctl.refresh().then(function () { ctl.render(box); });
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); ctl.refresh().then(function () { if (b.isOpen()) ctl.render(b.body); }); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  /* the browser's own parts, for the page to hand in */
  function browserHost(extra) {
    var w = W || {}, nav = w.navigator;
    return Object.assign({
      audio: function () { return typeof w.Audio === 'function' ? new w.Audio() : null; },
      devices: function () { return nav && nav.mediaDevices && nav.mediaDevices.enumerateDevices ? nav.mediaDevices.enumerateDevices() : Promise.resolve([]); },
      url: function (b) { return w.URL.createObjectURL(b instanceof w.Blob ? b : new w.Blob([b], { type: 'audio/wav' })); },
      revoke: function (u) { try { w.URL.revokeObjectURL(u); } catch (e) {} },
      store: { get: function () { try { return w.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }, set: function (v) { try { if (v) w.localStorage.setItem(KEY, v); else w.localStorage.removeItem(KEY); } catch (e) {} } }
    }, extra || {});
  }

  return { make: make, browserHost: browserHost, ringWav: ringWav, deviceList: deviceList, KEY: KEY };
});
