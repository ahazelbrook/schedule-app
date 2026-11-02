/* B68OnAir: the ON AIR lamp and "Blade, off the record" (suite ticket A6, switch ai.onair). Table display only; app/stt.js asks it, line by line.

   WHAT IT DOES
     - The lamp: while the iPad's mic is live a red ON AIR lamp shows at the top of the frame, on the band.
     - "Blade, off the record": the iPad stops keeping what it hears for 5 minutes and the lamp says OFF THE RECORD with a countdown.
     - "Blade, back on": keeping resumes at once. The 5 minutes also end by themselves.
   HOW. A heard line is judged here BEFORE it is queued (stt.js asks filter(text)). The line that holds the command, and every line while paused, is
   dropped: never queued, never posted, so it is not in the transcript and the cue lane never sees it (no cue verb and no server change for this). The mic
   and the Deepgram connection stay open while paused, on purpose: closing them would need a tap on the iPad to reopen, and "back on" could never be heard.
   What is heard while paused is thrown away on the iPad and not kept; it still travels to Deepgram, as the audio always does.
   The iPad reports status.pausedUntil (ms; 0 when not paused) with its other status, so the GM page mirrors the lamp and the countdown.

   API (Pure parts need no DOM; also exported for node)
     detect(text) -> 'off' | 'on' | null           the command a line holds (Blade, off the record / Blade, back on)
     make({ now }) -> air:
        air.filter(text) -> { drop, changed }       the verdict on one heard line; changed when the paused state flipped (so the page reports and repaints)
        air.paused() -> bool    air.until() -> ms | 0    air.remaining() -> ms
        air.pause(ms?) air.resume()
        air.paint(container, live) -> the lamp is drawn (live: the mic is open) or taken away
        air.destroy()
     shared() -> the one instance a page uses */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68OnAir = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var PAUSE_MS = 5 * 60 * 1000;

  function norm(t) { return String(t == null ? '' : t).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim(); }
  /* the wake word as Deepgram mishears it (the cue's own list) is trusted to PAUSE; only the real word RESUMES, so a mishearing can never turn the record back on */
  var OFF_RE = /\b(?:blade|blades|blaid|blayed|blake|blaine|played)(?: please)? (?:go )?off (?:the |this )?record\b/;
  var ON_RE = /\bblades?(?: please)? (?:back on|(?:back )?on the record|we are back on|we re back on)\b/;
  function detect(text) {
    var n = norm(text);
    if (!n) return null;
    var off = OFF_RE.exec(n), on = ON_RE.exec(n);
    if (off && on) return on.index > off.index ? 'on' : 'off';      /* the last thing said wins */
    return off ? 'off' : on ? 'on' : null;
  }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }

  function make(o) {
    var now = o && typeof o.now === 'function' ? o.now : Date.now, until = 0, lamp = null, text = null, seen = false;
    function paused() { if (until && now() >= until) until = 0; return until > 0; }
    var air = {
      paused: paused,
      until: function () { return paused() ? until : 0; },
      remaining: function () { return paused() ? until - now() : 0; },
      pause: function (ms) { until = now() + (ms > 0 ? ms : PAUSE_MS); },
      resume: function () { until = 0; },
      filter: function (t) {
        var cmd = detect(t), r;
        if (cmd === 'off') { air.pause(); r = { drop: true, changed: true }; }
        else if (cmd === 'on') { r = { drop: true, changed: paused() }; air.resume(); }
        else { var p = paused(); r = { drop: p, changed: p !== seen }; }
        seen = paused();
        return r;
      },
      paint: function (container, live) {
        var doc = container && container.ownerDocument;
        if (!doc) return;
        var p = paused();
        if (!live) { if (lamp && lamp.parentNode) lamp.parentNode.removeChild(lamp); lamp = null; text = null; return; }
        if (!lamp || lamp.parentNode !== container) {
          lamp = doc.createElement('div'); lamp.className = 'dp-onair'; lamp.setAttribute('role', 'status'); lamp.setAttribute('aria-live', 'polite');
          text = doc.createElement('span'); text.className = 'dp-onair-text'; lamp.appendChild(text); container.appendChild(lamp);
        }
        lamp.setAttribute('data-state', p ? 'off' : 'on');
        var t = p ? 'Off the record ' + clock(until - now()) : 'On air';
        if (text.textContent !== t) text.textContent = t;
      },
      destroy: function () { if (lamp && lamp.parentNode) lamp.parentNode.removeChild(lamp); lamp = null; until = 0; }
    };
    return air;
  }
  var one = null;
  function shared() { if (!one) one = make({}); return one; }

  return { detect: detect, make: make, shared: shared, PAUSE_MS: PAUSE_MS, clock: clock };
});
