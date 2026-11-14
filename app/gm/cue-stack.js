/* gm/cue-stack.js — the cue stack: STANDBY, GO and a panic key (suite ticket 4.1, switch room.cues).

   Plain script, UMD: window.B68GmCueStack in the browser, module.exports under Node. GM page only: a player's phone and the table display never load it, and nothing
   here fires by itself. A cue is fired by the GM pressing GO (Space, a page-turner key, the button) or by the GM saying "Blade, go". Blade the model never fires one:
   the spoken verb is parsed by the page and the Worker only takes it as a parsed cue (functions/_lib/assist/hands.js, CUE_DO_VERBS 'fire'; the model's own lane has
   no cue_do at all).

   WRITING CUES (the contract with whoever writes a score's prep note). A note's own `## Cues` section, outside code fences, outside any transcluded section:
       ## Cues
       safe: testcard                       (optional) the scene Esc sends the iPad to; an ambient scene id, default testcard ("Please stand by")
       1. scene: harvest                    pin an ambient scene on the iPad
       2. show: title: The Pelican Rooms | A night out        a brief beat; title <text> [| <sub>], ring <text>, spotted <text>, stamp <word>
       3. sound: Band strikes up            by hand: the card tells the GM what to play; GO logs it
       4. reveal: Ada Quill                 reveal a hidden NPC (by name)
       5. phase: score                      enter pb | plan | score | after on the night (and the iPad band)
       6. light: Lamps down, amber          by hand, as sound
       7. practical: Three knocks at the door     a practical sound, by hand
       8. music: action                     the laptop's music (gm/music.js): action | tension | calm | hanging around | auto | off
   One cue per numbered line (1. or 1) ), one kind each, in the order they are numbered in the list. A line that is not a cue is ignored and listed in
   parse().skipped. A repeated number keeps the first. The prep part already carries the section: it is the note's own Markdown (scripts/lib/prep-export.mjs).

   RUNNING THEM. The next cue not yet done is STANDBY. GO fires it (one 500 ms lock shared by GO, Bypass and Back, whichever way they come: two GOs within 500 ms fire
   once). Bypass marks it skipped without firing it. Back re-arms the last one (it undoes nothing on the iPad). "Blade, go" with nothing in standby does nothing but say so.
   The position lives in the GM state document (`cues`: { note, seq: [[n, 'f'|'b'] ...], panic, prior }), so a reload keeps it and another GM page follows it.

   PANIC. The band's last button, and Esc when nothing else is open (gm/esc.js decides; this file has no key listener of its own): the host clears every beat,
   layer and spotlight on the iPad, pins the safe scene (which plays no music, so the theme stops with it), and the cue's place in the band shows WORK LIGHT UP with
   Resume (the band turns its row red). It works with or without cues in the note. The app has no lamp or sound channel of its own: the lights and the practical
   sound are the GM's, and the banner is the prompt to put the work light up. Resume puts the iPad's scene back.

   THE FACE. The cue draws itself into the slot the band gives it (host.cueSlot(), gm/band.js), never anywhere else: STANDBY "#n KIND text", GO (Space), Bypass,
   and a ⋯ popover holding Back, Start again, the "Then:" list and the last line fired; NO CUES and ALL DONE when there is nothing to fire.

   API
     parse(note) -> { cues: [{ n, kind, arg, text, show? }], safe, skipped: [line] }        note = { blocks: [{ k, src }] } or a string
     create(host) -> controller
       host: { feature() -> bool, note() -> the prep note | null, doc() -> the GM state document, patch(p) -> bool, now() -> ms, toast(msg, bad), log(text),
               scene(id) -> Promise<bool>, show(kind, payload, { key }) -> Promise<answer | null>, reveal(name) -> Promise<{ ok, say, warn? } (on ok, say replaces Fired cue n.)>, phase(p) -> Promise<bool>,
               ambient() -> { mode, scene }, panic(safeScene) -> Promise, resume(prior) -> Promise, cueSlot() -> the band's element for the cue | null,
               changed() (optional: what the cue shows moved, so the band can follow), cueVerbs(), grammar() -> B68GmCueGrammar | null, grammarOn() -> bool, setTimeout }
       controller: view() go(src) bypass() back() reset() panic(src) resume() paint() tick() key(ev, doc) -> bool  moreOpen() closeMore()
                   register() unregister() destroy()
         key(ev, doc): the page's one key handler asks this for Space and PageDown (GO); true when it was a GO (fired, or locked out)
     LOCK_MS (500) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCueStack = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LOCK_MS = 500, BUSY_MS = 4000, SEQ_MAX = 200, DEFAULT_SAFE = 'testcard';
  var KINDS = ['scene', 'sound', 'show', 'reveal', 'phase', 'light', 'practical', 'music'];
  /* M1: `music: action | tension | calm | hanging around | auto | off` (gm/music.js plays it on the laptop) */
  var MUSIC_W = { action: 'action', tension: 'tension', tense: 'tension', calm: 'calm', 'hanging around': 'calm', hanging: 'calm', auto: 'auto', off: 'off', stop: 'off' };
  var MUSIC_LABEL = { action: 'Action', tension: 'Tension', calm: 'Hanging around', auto: 'Auto', off: 'Off' };
  var MANUAL = { sound: 1, light: 1, practical: 1 };
  var SHOW_KINDS = ['title', 'ring', 'spotted', 'stamp'];
  var PHASE_W = { pb: 'pb', personal: 'pb', downtime: 'pb', plan: 'plan', planning: 'plan', briefing: 'plan', score: 'score', heist: 'score', after: 'after', aftermath: 'after', payout: 'after' };
  var PHASE_LABEL = { pb: 'Personal Business', plan: 'Planning', score: 'Score', after: 'Aftermath' };
  var FILL = { now: 1, please: 1, ahead: 1, the: 1, next: 1, one: 1, cue: 1, okay: 1, ok: 1, um: 1, uh: 1, and: 1, then: 1, it: 1, on: 1 };
  var SCENE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clip(s, n) { s = str(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }
  function plain(s) { return str(s).replace(/[*_`]+/g, '').replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, function (m, a, b) { return b || a; }); }

  /* ---------- 1. parsing a prep note ---------- */
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  function sectionLines(src) {
    var out = [], fence = null, inCues = false;
    str(src).split('\n').forEach(function (ln) {
      var m = FENCE.exec(ln);
      if (fence) { if (m && m[1].charAt(0) === fence.charAt(0) && m[1].length >= fence.length) fence = null; return; }
      if (m) { fence = m[1]; return; }
      var h = /^ {0,3}(#{1,6}) +(.*?)[ \t]*#*[ \t]*$/.exec(ln);
      if (h) { inCues = h[1].length === 2 && /^cues$/i.test(plain(h[2]).trim()); return; }
      if (inCues) out.push(ln);
    });
    return out;
  }
  function showSpec(arg) {
    var m = /^([a-z]+)\s*[:\-–]?\s*(.*)$/i.exec(arg);
    if (!m || SHOW_KINDS.indexOf(m[1].toLowerCase()) < 0) return null;
    var kind = m[1].toLowerCase(), rest = clip(m[2], 200), parts = rest.split('|'), a = clip(parts[0], 100), b = clip(parts.slice(1).join(' '), 120);
    if (!a) return null;
    if (kind === 'title') return { kind: 'title', payload: b ? { text: clip(a, 80), sub: clip(b, 120) } : { text: clip(a, 80) } };
    if (kind === 'ring') return { kind: 'ring', payload: { text: clip(a, 60) } };
    if (kind === 'spotted') return { kind: 'spotted', payload: { text: clip(a, 60) } };
    return { kind: 'stamp', payload: { word: clip(a, 24) } };
  }
  function cueOf(n, kind, arg) {
    var c = { n: n, kind: kind, arg: arg, text: arg };
    if (kind === 'scene') {
      var id = arg.toLowerCase().split(/\s+/)[0];
      if (!SCENE_RE.test(id)) return null;
      c.arg = id; c.text = id;
    } else if (kind === 'show') {
      var sp = showSpec(arg); if (!sp) return null;
      c.show = sp; c.text = sp.kind + ': ' + (sp.payload.text || sp.payload.word) + (sp.payload.sub ? ' | ' + sp.payload.sub : '');
    } else if (kind === 'phase') {
      var p = PHASE_W[arg.toLowerCase().split(/\s+/)[0]]; if (!p) return null;
      c.arg = p; c.text = PHASE_LABEL[p];
    } else if (kind === 'reveal') {
      if (arg.length < 2) return null;
    } else if (kind === 'music') {
      var mw = MUSIC_W[arg.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()]; if (!mw) return null;
      c.arg = mw; c.text = MUSIC_LABEL[mw];
    } else if (!arg) return null;
    return c;
  }
  function parse(note) {
    var blocks = typeof note === 'string' ? [{ k: 'md', src: note }] : isObj(note) && Array.isArray(note.blocks) ? note.blocks : [];
    var cues = [], seen = {}, skipped = [], safe = '';
    blocks.forEach(function (b) {
      if (!isObj(b) || b.k === 'embed') return;                 /* the note's own Markdown, never a transcluded section */
      sectionLines(b.src).forEach(function (ln) {
        var t = plain(ln).replace(/^[\s>]*(?:[-*+]\s+)?/, '').trim();
        if (!t) return;
        var sm = /^safe\s*[:=]\s*([A-Za-z0-9-]+)\s*$/i.exec(t);
        if (sm) { if (SCENE_RE.test(sm[1].toLowerCase())) safe = sm[1].toLowerCase(); return; }
        var m = /^(\d{1,3})[.)]\s+([a-z]+)\b\s*[:\-–]?\s*(.*)$/i.exec(t);
        if (!m || KINDS.indexOf(m[2].toLowerCase()) < 0) { skipped.push(clip(t, 80)); return; }
        var n = +m[1], c = cueOf(n, m[2].toLowerCase(), clip(m[3], 200));
        if (!c || n < 1 || seen[n]) { skipped.push(clip(t, 80)); return; }
        seen[n] = 1; cues.push(c);
      });
    });
    return { cues: cues, safe: safe || DEFAULT_SAFE, skipped: skipped };
  }

  /* ---------- 2. the position ---------- */
  function cleanState(raw, noteId) {
    var out = { note: str(noteId), seq: [], panic: 0, prior: null };
    if (!isObj(raw) || raw.note !== out.note) return out;
    if (Array.isArray(raw.seq)) raw.seq.slice(-SEQ_MAX).forEach(function (e) {
      if (Array.isArray(e) && Number.isInteger(e[0]) && e[0] > 0 && (e[1] === 'f' || e[1] === 'b') && !out.seq.some(function (x) { return x[0] === e[0]; })) out.seq.push([e[0], e[1]]);
    });
    if (typeof raw.panic === 'number' && isFinite(raw.panic) && raw.panic > 0) out.panic = Math.round(raw.panic);
    if (isObj(raw.prior)) out.prior = { mode: raw.prior.mode === 'pin' || raw.prior.mode === 'off' ? raw.prior.mode : 'auto', scene: SCENE_RE.test(str(raw.prior.scene)) ? raw.prior.scene : null };
    return out;
  }
  function standbyOf(cues, seq) {
    var done = {}; seq.forEach(function (e) { done[e[0]] = e[1]; });
    return cues.filter(function (c) { return !done[c.n]; });
  }

  /* ---------- 3. the controller ---------- */
  function create(host) {
    host = host || {};
    var lastAt = -1e12, busy = false, busyAt = 0, last = '', slot = null, sig = '', parsed = null, parsedFor = null, registered = [], alive = true, more = false;
    function on() { return alive && typeof host.feature === 'function' ? !!host.feature() : false; }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function note() { return typeof host.note === 'function' ? host.note() : null; }
    function noteId() { var n = note(); return isObj(n) ? str(n.id) : ''; }
    function stored() { var d = typeof host.doc === 'function' ? host.doc() : null; return isObj(d) ? d.cues : null; }

    function view() {
      var n = note();
      if (n !== parsedFor || !parsed) { parsed = parse(n); parsedFor = n; }
      var id = noteId(), st = cleanState(stored(), id), left = standbyOf(parsed.cues, st.seq);
      return { noteId: id, cues: parsed.cues, safe: parsed.safe, skipped: parsed.skipped, seq: st.seq, panic: st.panic, prior: st.prior,
        standby: left[0] || null, next: left.slice(1, 4), left: left.length, total: parsed.cues.length, last: last };
    }
    function save(v, seq, extra) {
      var cues = { note: v.noteId, seq: seq };
      if (extra) Object.keys(extra).forEach(function (k) { cues[k] = extra[k]; });
      return typeof host.patch === 'function' ? host.patch({ cues: cues }) !== false : false;
    }
    function label(c) { return '#' + c.n + ' ' + c.kind.toUpperCase() + ' ' + c.text; }

    /* one cue's effect on the iPad or the night -> Promise<{ ok, say? }> (a manual cue has none: the GM does it by hand) */
    function effect(c, v) {
      function ok(r) { return r ? { ok: true } : { ok: false, say: 'Cue ' + c.n + ' did not fire.' }; }
      try {
        if (MANUAL[c.kind]) return Promise.resolve({ ok: true, manual: true });
        if (c.kind === 'scene') return Promise.resolve(host.scene(c.arg)).then(ok);
        if (c.kind === 'show') return Promise.resolve(host.show(c.show.kind, c.show.payload, { key: 'cue-' + v.noteId + '-' + c.n })).then(function (r) { return ok(r !== null && r !== undefined); });
        if (c.kind === 'reveal') return Promise.resolve(host.reveal(c.arg)).then(function (r) { return r && r.ok ? { ok: true, say: r.say || '', warn: !!r.warn } : { ok: false, say: (r && r.say) || 'Could not reveal ' + c.arg + '.' }; });
        if (c.kind === 'phase') return Promise.resolve(host.phase(c.arg)).then(ok);
        if (c.kind === 'music') return Promise.resolve(typeof host.music === 'function' ? host.music(c.arg) : false).then(function (r) { return r ? { ok: true } : { ok: false, say: 'Cue ' + c.n + ': the music is not on this page.' }; });
      } catch (e) { /* falls through to a failure */ }
      return Promise.resolve({ ok: false, say: 'Cue ' + c.n + ' did not fire.' });
    }
    function locked(t) { return t - lastAt < LOCK_MS || (busy && t - busyAt < BUSY_MS); }

    /* GO: fire the cue in standby. src is 'key', 'button' or 'voice' (the same lock whichever it is) */
    function go(src) {
      if (!on()) return Promise.resolve({ ok: false, reason: 'off' });
      var t = now(); if (locked(t)) return Promise.resolve({ ok: false, reason: 'lock' });
      var v = view();
      if (v.panic) { say('The work light is up: press Resume first.', true); return Promise.resolve({ ok: false, reason: 'panic' }); }
      if (!v.standby) { say('Nothing in standby.'); paint(); return Promise.resolve({ ok: false, reason: 'none' }); }
      var c = v.standby; lastAt = t; busy = true; busyAt = t;
      return effect(c, v).then(function (r) {
        busy = false;
        if (!r.ok) { say(r.say || 'That cue did not fire.', true); paint(); return { ok: false, reason: 'failed', n: c.n }; }
        var v2 = view(); save(v2, v2.seq.concat([[c.n, 'f']]));
        last = (c.manual || MANUAL[c.kind] ? 'By hand: ' : 'Fired: ') + label(c);
        if (typeof host.log === 'function') { try { host.log('Cue ' + c.n + ' ' + c.kind + ': ' + c.text); } catch (e) {} }
        say(r.say ? r.say : MANUAL[c.kind] ? 'Cue ' + c.n + ': ' + c.text + ' (by hand)' : 'Fired cue ' + c.n + '.', !!r.warn);      /* IP3b: a fired cue may say its own one line (a reveal that could not be shown) */
        paint(); return { ok: true, n: c.n, kind: c.kind, src: src };
      }, function () { busy = false; say('Cue ' + c.n + ' did not fire.', true); paint(); return { ok: false, reason: 'failed', n: c.n }; });
    }
    function bypass() {
      if (!on()) return { ok: false, reason: 'off' };
      var t = now(); if (locked(t)) return { ok: false, reason: 'lock' };
      var v = view(); if (!v.standby) return { ok: false, reason: 'none' };
      lastAt = t; save(v, v.seq.concat([[v.standby.n, 'b']]));
      last = 'Bypassed: ' + label(v.standby);
      if (typeof host.log === 'function') { try { host.log('Cue ' + v.standby.n + ' bypassed'); } catch (e) {} }
      paint(); return { ok: true, n: v.standby.n };
    }
    function back() {
      if (!on()) return { ok: false, reason: 'off' };
      var t = now(); if (locked(t)) return { ok: false, reason: 'lock' };
      var v = view(); if (!v.seq.length) return { ok: false, reason: 'none' };
      lastAt = t; save(v, v.seq.slice(0, -1)); last = ''; paint(); return { ok: true, n: v.seq[v.seq.length - 1][0] };
    }
    function reset() {
      if (!on()) return { ok: false, reason: 'off' };
      var v = view(); save(v, [], { panic: null, prior: null }); last = ''; paint(); return { ok: true };
    }

    /* PANIC: no lock, nothing waits on it. The cue's place goes red at once; the iPad is cleared and the safe scene pinned in parallel. */
    function panic(src) {
      if (!on()) return Promise.resolve({ ok: false, reason: 'off' });
      var t = now(), v = view(), prior = v.panic && v.prior ? v.prior : (typeof host.ambient === 'function' ? host.ambient() : null);
      busy = false; more = false;
      save(v, v.seq, { panic: t, prior: isObj(prior) ? { mode: prior.mode === 'pin' || prior.mode === 'off' ? prior.mode : 'auto', scene: SCENE_RE.test(str(prior.scene)) ? prior.scene : null } : null });
      paint();
      return Promise.resolve().then(function () { return host.panic(v.safe); }).then(function (r) {
        var ms = now() - t; return { ok: r !== false, ms: ms, safe: v.safe, src: src };
      }, function () { say('The iPad could not be reached: press Clear (0) in the band.', true); return { ok: false, safe: v.safe, src: src }; });
    }
    function resume() {
      if (!on()) return Promise.resolve({ ok: false, reason: 'off' });
      var v = view(); if (!v.panic) return Promise.resolve({ ok: false, reason: 'none' });
      save(v, v.seq, { panic: null, prior: null }); paint();
      return Promise.resolve().then(function () { return typeof host.resume === 'function' ? host.resume(v.prior) : null; }).then(function () { return { ok: true }; }, function () { return { ok: false }; });
    }

    /* ---------- the face: the band's cue slot ---------- */
    var slotOff = null;
    function slotEl() { var s = typeof host.cueSlot === 'function' ? host.cueSlot() : null; return s && typeof s.querySelector === 'function' ? s : null; }
    function onSlotClick(ev) {
      var b = ev && ev.target && ev.target.closest ? ev.target.closest('[data-cs]') : null; if (!b || !alive) return;
      var w = b.getAttribute('data-cs');
      if (w === 'more') { more = !more; sig = ''; paint(); return; }
      if (w === 'go') go('button');
      else if (w === 'bypass') bypass();
      else if (w === 'resume') resume();
      else if (w === 'back' || w === 'reset') { more = false; if (w === 'back') back(); else reset(); }
    }
    function bindSlot(s) {
      if (slot === s) return;
      if (slotOff) { try { slotOff(); } catch (e) {} slotOff = null; }
      slot = s; sig = ''; more = false;
      if (typeof s.addEventListener === 'function') {
        s.addEventListener('click', onSlotClick);
        slotOff = function () { if (typeof s.removeEventListener === 'function') s.removeEventListener('click', onSlotClick); };
      }
    }
    /* the ⋯ popover: the standby in full, what comes next, the last line fired, Back and Start again */
    function popHtml(v) {
      var h = '<div class="gm-cs-pop" data-cs-pop role="dialog" aria-label="The cue stack"' + (more ? '' : ' hidden') + '>';
      if (v.standby) h += '<p class="gm-cs-full"><b>STANDBY</b> ' + esc(label(v.standby)) + (MANUAL[v.standby.kind] ? ' <span class="gm-cs-hand">by hand</span>' : '') + '</p>';
      if (v.next.length) h += '<p class="gm-cs-next"><b>Then:</b> ' + v.next.map(function (x) { return esc('#' + x.n + ' ' + x.kind + ': ' + x.text); }).join(' &middot; ') + '</p>';
      if (v.last) h += '<p class="gm-cs-last">' + esc(v.last) + '</p>';
      if (!v.total) h += '<p class="gm-cs-last">This note has no Cues section: a "## Cues" heading with numbered lines makes one.</p>';
      else if (!v.standby) h += '<p class="gm-cs-last">Every cue in this note has been fired or bypassed.</p>';
      h += '<div class="gm-cs-popacts">' + (v.seq.length ? '<button type="button" class="btn sm" data-cs="back" title="Put the last cue back in standby (it undoes nothing on the iPad)">Back</button>' +
        '<button type="button" class="btn sm" data-cs="reset" title="Every cue back in standby, from the first">Start again</button>' : '<span class="gm-cs-dim">Nothing fired yet.</span>') + '</div>';
      return h + '</div>';
    }
    function html(v) {
      if (v.panic) {
        var say2 = 'The iPad is on the safe scene (' + v.safe + ') and its sound is down. Put the work light on in the room.';
        return '<span class="gm-cs-tag gm-cs-alarm" role="alert">WORK LIGHT UP</span><span class="gm-cs-txt" title="' + esc(say2) + '">' + esc(say2) + '</span>' +
          '<button type="button" class="gm-cs-resume" data-cs="resume" title="Put the iPad’s scene back">Resume</button>';
      }
      var dots = '<button type="button" class="gm-cs-more" data-cs="more" aria-haspopup="dialog" aria-expanded="' + more + '" aria-label="The cue stack: Back, Start again, what comes next" title="Back, Start again, what comes next and the last cue fired">⋯</button>';
      if (v.standby) {
        var c = v.standby;
        return '<span class="gm-cs-tag">STANDBY</span>' +
          '<button type="button" class="gm-cs-what" data-cs="more" aria-expanded="' + more + '" title="' + esc(label(c)) + '"><b>#' + c.n + '</b> ' + esc(c.kind.toUpperCase()) + ' ' + esc(c.text) + '</button>' +
          (MANUAL[c.kind] ? '<span class="gm-cs-hand">by hand</span>' : '') +
          '<button type="button" class="gm-cs-go" data-cs="go" title="Fire the cue in standby (Space)">GO <kbd>Space</kbd></button>' +
          '<button type="button" class="gm-cs-soft" data-cs="bypass" title="Skip this cue without firing it">Bypass</button>' + dots + popHtml(v);
      }
      return '<span class="gm-cs-tag gm-cs-idle">' + (v.total ? 'ALL DONE' : 'NO CUES') + '</span>' +
        '<span class="gm-cs-txt gm-cs-dim">' + (v.total ? 'Every cue fired or bypassed' : 'No Cues in this note') + '</span>' + dots + popHtml(v);
    }
    function paint() {
      if (!alive) return;
      var s = slotEl();
      if (!on()) { if (s && s === slot) { s.innerHTML = ''; s.removeAttribute('data-state'); } sig = ''; return; }
      if (!s) return;
      bindSlot(s);
      var v = view(), k = JSON.stringify([v.noteId, v.seq, v.panic, v.safe, v.standby && v.standby.n, v.next.map(function (x) { return x.n; }), v.total, v.last, more]);
      if (k !== sig) {
        var KB = typeof window !== 'undefined' && window.B68KitBand && window.B68KitBand.on() && window.B68KitBand.inBand(s) ? window.B68KitBand : null;      /* KS05: the new desk's cue unit */
        sig = k; s.innerHTML = KB ? KB.cueHtml(v, { more: more, label: label, manual: MANUAL, pop: popHtml(v) }) : html(v); s.setAttribute('data-state', v.panic ? 'panic' : v.standby ? 'standby' : 'idle');
        if (typeof host.changed === 'function') { try { host.changed(); } catch (e) { /* the band follows on its next tick */ } }
      }
    }
    function tick() { paint(); }
    function moreOpen() { return !!(alive && more && slot); }
    function closeMore() { if (!more) return; more = false; sig = ''; paint(); }

    /* ---------- the keys: asked by the page's one key handler (no listener of its own) ---------- */
    function typing(t) {
      if (!t || !t.tagName) return false;
      var tn = str(t.tagName).toUpperCase();
      return tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || t.isContentEditable === true;
    }
    function dialogOpen(doc) { return !!(doc && doc.querySelector && doc.querySelector('dialog[open]')); }
    /* Space is GO only when the focus is on the page itself (or the cue's own place, not one of its buttons): on any other button, link or task box it is that
       control's own press. PageDown is the page-turner's key and works anywhere but a field. With no cues in the note, the keys are the page's own. */
    function key(ev, doc) {
      if (!alive || !on() || !ev || ev.ctrlKey || ev.altKey || ev.metaKey) return false;
      var k = ev.key, tg = ev.target;
      if (k !== ' ' && k !== 'Spacebar' && k !== 'PageDown') return false;
      if (dialogOpen(doc) || typing(tg)) return false;
      var tn = tg && tg.tagName ? str(tg.tagName).toUpperCase() : '', inSlot = !!(tg && slot && typeof slot.contains === 'function' && slot.contains(tg));
      if (k !== 'PageDown' && tg && tn !== 'BODY' && tn !== 'HTML' && !inSlot) return false;
      if (k !== 'PageDown' && inSlot && tn === 'BUTTON') return false;                       /* a focused cue button: the browser's click does it */
      var v = view(); if (!v.total && !v.panic) return false;
      if (ev.preventDefault) ev.preventDefault();
      if (!ev.repeat) go('key');
      return true;
    }

    /* ---------- "Blade, go" ---------- */
    function parseSpoken(ctx) {
      var ws = isObj(ctx) && Array.isArray(ctx.words) ? ctx.words : [];
      if (ws.every(function (w) { return FILL[w]; })) return { action: { type: 'cue_do', verb: 'fire' } };
      var G = typeof host.grammar === 'function' ? host.grammar() : null;
      if (G && typeof G.parseGo === 'function' && typeof host.grammarOn === 'function' && host.grammarOn()) return G.parseGo(ctx);     /* "go planning": A2's verb, while its switch is on */
      return { refused: 'unparsed' };
    }
    function register() {
      var cv = typeof host.cueVerbs === 'function' ? host.cueVerbs() : null;
      if (!cv || registered.length) return registered.slice();
      try { cv.register({ id: 'cuego', phrases: [['go']], actionTypes: ['cue_do'], enabled: on, label: 'Go (cue stack)', parse: parseSpoken }); registered.push('cuego'); } catch (e) { /* the phrase is taken: spoken go stays as it was */ }
      return registered.slice();
    }
    function unregister() {
      var cv = typeof host.cueVerbs === 'function' ? host.cueVerbs() : null;
      registered.forEach(function (id) { if (cv) cv.unregister(id); });
      registered = [];
    }
    /* a parsed cue_do 'fire' action -> Promise<{ ok }>; with nothing in standby (or the switch off) nothing happens */
    function run(action) {
      if (!on() || !isObj(action) || action.type !== 'cue_do' || action.verb !== 'fire') return Promise.resolve({ ok: false });
      return go('voice');
    }
    function destroy() {
      alive = false; more = false; unregister();
      if (slotOff) { try { slotOff(); } catch (e) {} slotOff = null; }
      if (slot) { try { slot.innerHTML = ''; slot.removeAttribute('data-state'); } catch (e) {} }
      slot = null; sig = '';
    }

    return { view: view, go: go, bypass: bypass, back: back, reset: reset, panic: panic, resume: resume, paint: paint, tick: tick, key: key, moreOpen: moreOpen, closeMore: closeMore,
      run: run, register: register, unregister: unregister, destroy: destroy, parseSpoken: parseSpoken };
  }

  return { LOCK_MS: LOCK_MS, KINDS: KINDS, DEFAULT_SAFE: DEFAULT_SAFE, parse: parse, cleanState: cleanState, standbyOf: standbyOf, create: create };
});
