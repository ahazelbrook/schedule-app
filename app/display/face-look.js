/* display/face-look.js — the shared, pure half of the face looks (suite 3.2, 3.3, 3.4; switches face.expressions, face.formats, face.badge).

   Window.B68FaceLook, and module.exports under Node. The Worker imports it too (functions/_lib/gm.js), so it has no DOM, no clock and no network.

   WHAT A LOOK IS. A held spotlight (the `npc` overlay) may carry ONE extra key, `look`: { expr?, pose?, fmt?, re? }. Every value is a name from a list below; nothing
   free-form, so a look can carry no text and no secret. The GM page works the names out from the NPC's GM-only notes (parseNotes) and sends only the names; the iPad
   never sees the notes. The server and the iPad each run clean() again, so a bad value is dropped, never repaired.
     expr   neutral | pleased | hostile | afraid, or one of TELLS (an NPC's tell is one of the kit's own expression presets)
     pose   a name from POSES (the kit's arm poses): the signature pose, played once
     fmt    licence | badge | mugshot | society | passport
     tell   true when expr is the person's tell (IP1): the iPad plays it every 12 to 20 s while they are up, unless the screen is held still
     re     true when this is the GM page laying the same spotlight again (the hold is renewed before it runs out): the iPad keeps the expression and format
            and does not replay the pose or the motif
   The badge number, the faction glyph and style, and the motif are worked out on the iPad from the NPC's id and faction (already served), so they add no field here.

   WHERE A TELL IS KEPT (GM-only, in the NPC's gmNotes, one line each; a line the GM has not written is simply absent):
     Tell: smirk — touches his cuff           the first word is a TELLS name (or pleased, hostile, afraid, neutral)
     Signature: lapel                         the first word is a POSES name
     Relation: resident                       the first word is a RELATIONS word (or a format name): it chooses the portrait format

   API
     EXPRS TELLS POSES FMTS RELATIONS MAP
     clean(raw) -> a fresh look | null         parseNotes(gmNotes) -> { tell, signature, fmt }
     kitExpression(name) -> the kit's expression name for a look name | ''
     specWith(spec, look) -> a copy of the spec with the expression (and nothing else) changed; the spec itself, untouched, when there is no expression
     poseSpec(spec, pose) -> a copy of the spec with its arms in the signature pose
     colours(slot) -> [fill, ink] hex pair for a faction slot (the F6 tokens when B68Tokens is loaded, else the same values)
     hash(str) -> uint32     slotOf(faction) -> 1..6 | 0     numberOf(npcId) -> 'No. 417'     glyphOf(faction) -> 0..7 */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68FaceLook = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var CORE = ['neutral', 'pleased', 'hostile', 'afraid'];
  var TELLS = ['stern', 'smirk', 'tired', 'wary', 'surprised', 'sneer', 'sad', 'cool', 'determined', 'amused', 'grin', 'laugh', 'shout'];
  var EXPRS = CORE.concat(TELLS);
  var POSES = ['pocket', 'hip', 'cross', 'smoke', 'hold', 'behind', 'carry', 'raise', 'lapel'];
  var FMTS = ['licence', 'badge', 'mugshot', 'society', 'passport'];
  /* the five expressions as the kit knows them (afraid is registered by face-render.js from the kit's own parts) */
  var MAP = { neutral: 'neutral', pleased: 'smile', hostile: 'scowl', afraid: 'afraid' };
  /* the words for how a person stands to the city -> the portrait format that suits them */
  var RELATIONS = {
    resident: 'licence', local: 'licence', citizen: 'licence', civilian: 'licence', driver: 'licence', tenant: 'licence',
    staff: 'badge', employee: 'badge', official: 'badge', officer: 'badge', guard: 'badge', security: 'badge', clerk: 'badge', worker: 'badge',
    suspect: 'mugshot', criminal: 'mugshot', wanted: 'mugshot', offender: 'mugshot', arrested: 'mugshot', fugitive: 'mugshot',
    society: 'society', socialite: 'society', celebrity: 'society', patron: 'society', elite: 'society', famous: 'society',
    foreign: 'passport', foreigner: 'passport', visitor: 'passport', outsider: 'passport', stranger: 'passport', traveller: 'passport', arrival: 'passport'
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function has(list, v) { return typeof v === 'string' && list.indexOf(v) >= 0; }

  function clean(raw) {
    if (!isObj(raw)) return null;
    var out = {};
    if (has(EXPRS, raw.expr)) out.expr = raw.expr;
    if (has(POSES, raw.pose)) out.pose = raw.pose;
    if (has(FMTS, raw.fmt)) out.fmt = raw.fmt;
    if (raw.re === true) out.re = true;
    if (raw.tell === true && out.expr) out.tell = true;      /* IP1: expr is the person's own tell, so the iPad plays it now and then rather than wearing it */
    return Object.keys(out).length ? out : null;
  }

  function firstWord(s) { var m = /^[\s"'“‘(]*([A-Za-z]+)/.exec(String(s == null ? '' : s)); return m ? m[1].toLowerCase() : ''; }
  /* the three GM-only lines of an NPC's notes -> names (an empty string where the line is absent or its word is not on a list) */
  function parseNotes(notes) {
    var out = { tell: '', signature: '', fmt: '' }, fence = null, lines = String(notes == null ? '' : notes).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1].charAt(0); else if (f[1].charAt(0) === fence) fence = null; continue; }
      if (fence) continue;
      var m = /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:\*\*|__)?(tell|signature|relation)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i.exec(l);
      if (!m) continue;
      var key = m[1].toLowerCase(), w = firstWord(m[2]);
      if (key === 'tell' && !out.tell && has(EXPRS, w)) out.tell = w;
      else if (key === 'signature' && !out.signature && has(POSES, w)) out.signature = w;
      else if (key === 'relation' && !out.fmt) out.fmt = has(FMTS, w) ? w : (Object.prototype.hasOwnProperty.call(RELATIONS, w) ? RELATIONS[w] : '');
    }
    return out;
  }

  function kitExpression(name) { return Object.prototype.hasOwnProperty.call(MAP, name) ? MAP[name] : has(TELLS, name) ? name : ''; }

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  /* the expression changes the spec's face.expression and nothing else; no expression means the very same object back (so a plain card draws byte for byte as before) */
  function specWith(spec, look) {
    var k = isObj(look) ? kitExpression(look.expr) : '';
    if (!k || !isObj(spec)) return spec;
    var s = copy(spec); s.face = isObj(s.face) ? s.face : {}; s.face.expression = k;
    return s;
  }
  /* the signature pose: the working arm (R) takes the named arm pose; folded arms are set on both sides, as the kit asks */
  function poseSpec(spec, pose) {
    if (!has(POSES, pose) || !isObj(spec)) return spec;
    var s = copy(spec); s.pose = isObj(s.pose) ? s.pose : {}; s.pose.arms = isObj(s.pose.arms) ? s.pose.arms : {};
    s.pose.arms.R = pose; if (pose === 'cross') s.pose.arms.L = 'cross';
    return s;
  }

  /* FNV-1a, 32 bits: a stable number from a string (the same on every device, no clock) */
  function hash(str) {
    var h = 0x811c9dc5, s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
  /* a faction takes one of the six F6 colour slots by its name (the tokens leave the assignment to data; this is the stable default); 0 for no faction */
  function slotOf(faction) { var f = norm(faction); return f ? (hash('slot:' + f) % 6) + 1 : 0; }
  function glyphOf(faction) { var f = norm(faction); return f ? hash('glyph:' + f) % 8 : 0; }
  function numberOf(npcId) { var n = (hash('no:' + String(npcId)) % 900) + 100; return 'No. ' + n; }

  /* the six faction colours of app/tokens.css, as the tokens give them when B68Tokens is loaded (the same values otherwise) */
  var FALLBACK_COLOURS = { 1: ['#e0691e', '#14110e'], 2: ['#3f62c4', '#fbf8f1'], 3: ['#6e8f6a', '#14110e'], 4: ['#c9348c', '#fbf8f1'], 5: ['#6e8a8c', '#14110e'], 6: ['#e8c33c', '#14110e'] };
  function colours(slot) {
    var T = root && root.B68Tokens, c = FALLBACK_COLOURS[slot] || ['#8e8880', '#14110e'];
    if (T && T.faction) { try { var f = T.faction(slot); if (f && f.fill) return [f.fill, f.ink || c[1]]; } catch (e) { /* the fallback */ } }
    return c;
  }

  return { EXPRS: EXPRS, TELLS: TELLS, POSES: POSES, FMTS: FMTS, RELATIONS: RELATIONS, MAP: MAP, clean: clean, parseNotes: parseNotes, kitExpression: kitExpression,
    specWith: specWith, poseSpec: poseSpec, hash: hash, colours: colours, slotOf: slotOf, glyphOf: glyphOf, numberOf: numberOf };
});
