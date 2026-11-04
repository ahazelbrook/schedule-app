/* B68GmLight: one light cue (suite ticket 4.6, switch room.light). The strip follows the scene's palette; one alarm moment runs on the rim lights only, for 3 seconds,
   never faster than 2 Hz; the work light never changes. Pure: no DOM, no clock. The browser cannot reach lights on the network, so a small relay on the laptop
   (tools/light-relay.mjs, which loads this same file for its limits) does it; this file builds and checks the commands and holds the client that posts them.

   The limits are HARD and live here once: the relay enforces them again on whatever it is sent, so a hand-made request cannot exceed them.
     ALARM_MS 3000     the alarm's whole length            STEP_MS 260   the shortest step the schedule uses; GUARD_MS 250 is the floor the relay holds between two changes of the rim (250 ms on + 250 ms off = 2 Hz;
                       the 10 ms of margin keeps a timer that fires early from being dropped)
     CHANNELS          strip and rim only: any other channel (the work light included) is refused

   API (also module.exports under Node)
     LIMITS { ALARM_MS, STEP_MS, CHANNELS }
     stripColour(scene) -> [r,g,b]       scene: a palette { accent: '#rrggbb' } or a scene id (a fixed colour from the id)
     command(channel, spec) -> { channel, ... }   check(cmd) -> { ok, cmd } | { ok: false, why }      (clamps; never widens)
     alarmSteps(ms, step) -> [{ at, on }]          the rim's on/off schedule, clamped to the limits, always ending off
     create({ enabled, fetch, base }) -> { follow(scene) -> Promise<bool>, alarm() -> Promise<bool> }   enabled() is read on every call; off means no fetch at all */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmLight = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = Object.freeze({ ALARM_MS: 3000, STEP_MS: 260, GUARD_MS: 250, CHANNELS: Object.freeze(['strip', 'rim']) });
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function byte(n) { n = Math.round(Number(n)); return isFinite(n) ? Math.min(255, Math.max(0, n)) : 0; }

  function hexRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)] : null; }
  function hueRgb(h) {         /* hsl(h, 55%, 45%) */
    var s = 0.55, l = 0.45, c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, i = Math.floor(h / 60) % 6;
    var t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
    return t.map(function (v) { return byte((v + m) * 255); });
  }
  function stripColour(scene) {
    if (isObj(scene)) { var rgb = hexRgb(scene.accent) || hexRgb(scene.bg); if (rgb) return rgb; scene = scene.id; }
    var s = String(scene == null ? '' : scene), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return hueRgb(h);
  }
  function command(channel, spec) {
    var c = { channel: String(channel) }, p = isObj(spec) ? spec : {};
    if (p.rgb) c.rgb = p.rgb;
    if (p.alarm) { c.alarm = true; if (p.durationMs != null) c.durationMs = p.durationMs; if (p.stepMs != null) c.stepMs = p.stepMs; }
    return c;
  }
  function check(cmd) {
    if (!isObj(cmd)) return { ok: false, why: 'not a command' };
    if (LIMITS.CHANNELS.indexOf(cmd.channel) < 0) return { ok: false, why: 'channel ' + String(cmd.channel).slice(0, 20) + ' is not allowed' };
    if (cmd.channel === 'strip') {
      if (cmd.alarm) return { ok: false, why: 'the strip takes a colour only' };
      if (!Array.isArray(cmd.rgb) || cmd.rgb.length !== 3) return { ok: false, why: 'the strip needs rgb' };
      return { ok: true, cmd: { channel: 'strip', rgb: cmd.rgb.map(byte) } };
    }
    if (cmd.alarm !== true) return { ok: false, why: 'the rim takes an alarm only' };
    var dur = Number(cmd.durationMs), st = Number(cmd.stepMs);
    return { ok: true, cmd: { channel: 'rim', alarm: true,
      durationMs: isFinite(dur) && dur > 0 ? Math.min(dur, LIMITS.ALARM_MS) : LIMITS.ALARM_MS,
      stepMs: isFinite(st) ? Math.max(st, LIMITS.STEP_MS) : LIMITS.STEP_MS } };
  }
  function alarmSteps(ms, step) {
    var dur = Number(ms), st = Number(step);
    dur = isFinite(dur) && dur > 0 ? Math.min(dur, LIMITS.ALARM_MS) : LIMITS.ALARM_MS;
    st = isFinite(st) ? Math.max(st, LIMITS.STEP_MS) : LIMITS.STEP_MS;
    var out = [], on = true;
    for (var at = 0; at < dur; at += st) { out.push({ at: at, on: on }); on = !on; }
    if (out.length && out[out.length - 1].on) out.push({ at: Math.min(dur, out[out.length - 1].at + st), on: false });
    else if (!out.length) out.push({ at: 0, on: false });
    return out;
  }
  function create(deps) {
    var d = deps || {}, last = '';
    function on() { return typeof d.enabled === 'function' && d.enabled() === true && typeof d.fetch === 'function'; }
    function post(cmd) {
      return Promise.resolve().then(function () {
        return d.fetch(String(d.base || 'http://127.0.0.1:9300') + '/light', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
      }).then(function (r) { return !!(r && r.ok); }, function () { return false; });     /* a relay that is not running is not an error on the GM page */
    }
    return {
      follow: function (scene) {
        if (!on()) return Promise.resolve(false);
        var c = command('strip', { rgb: stripColour(scene) }), key = c.rgb.join(',');
        if (key === last) return Promise.resolve(false);
        last = key; return post(c);
      },
      alarm: function () { return on() ? post(command('rim', { alarm: true })) : Promise.resolve(false); }
    };
  }
  return { LIMITS: LIMITS, stripColour: stripColour, command: command, check: check, alarmSteps: alarmSteps, create: create };
});
