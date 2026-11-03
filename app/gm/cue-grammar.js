/* gm/cue-grammar.js — a strict cue grammar, a toast and Undo (suite A2, switch ai.grammar).

   Plain script, UMD: window.B68GmCueGrammar in the browser, module.exports under Node. GM page only. It fills the cue's verb registry (app/cue-verbs.js) with this
   week's verbs, carries each one out through the host the page gives it, and shows a five-second toast with Undo for every cue that fires. Nothing here calls a
   model: a verb is a grammar, and what it cannot parse is "didn't catch that" and does nothing.

   THE VERBS (each parse() returns one { type: 'cue_do', verb, ... } action, and no other type; the Worker's validateActions checks it, hands.js CUE_DO_VERBS)
     stamp            "Blade, stamp risky standard, the guard turns" / "Blade, risky, standard" / "controlled ... limited": both a position
                      (controlled risky desperate) and an effect (limited standard great), then an optional one-line threatened consequence
     reveal <name>    reveal a hidden NPC to the players (the cast document's own flag); takes over the built-in word "reveal", which refused as "show"
     go <phase>       enter personal business, planning, score or aftermath on the night (and the iPad band)
     flashback        the iPad's flashback filter on          back    the filter off (a bare "back"; "back on" is the verb below)
     introduce <names>  the rolodex beat, for revealed NPCs only        spotlight <name>  the spotlight beat, a revealed NPC only
     ("off the record" and "back on" belong to A6 / ai.onair, which handles them before the cue lane: no cue verb here, and "back on" is refused by "back")
   NOT HERE: "name them". The suite plan names it without saying what it does, so it is left out rather than guessed.
   Every verb is enabled() only while the switch is on, so with it off the registry answers as if nothing were registered.
   A word another bundle has already registered is skipped (register() throws on a clash and the throw is caught per verb), never fatal.

   SECRECY. A hidden NPC never reaches the iPad: reveal is the only way to change that and it is the GM's own cue; introduce and spotlight refuse a hidden
   NPC by name before anything is sent (the Worker refuses too). The stamp's consequence line goes through the page's usual hidden-name scan.

   API
     parseStamp(ctx) parseGo(ctx) ... VERBS            the pure parsers, for tests
     create(host) -> controller
       host: { feature(id) -> bool, cueVerbs() -> B68CueVerbs, stamp() -> B68GmStamp controller | null, night() -> B68GmNight controller | null,
               layer(path, value) -> Promise, layerValue(path) -> value, npcs() -> [{ id, name, alias?, revealed }], reveal(id, bool) -> Promise,
               show(kind, payload, { key }) -> Promise<answer | null>, overlayId() -> id, clearOverlay() -> Promise, keyFor(key) -> id,
               toast(msg, bad), doc() -> document, setTimeout/clearTimeout }
       controller: register() unregister() run(action) -> Promise<{ ok, say }>  undoToast(text, fn)  didntCatch()  hide()   TOAST_MS */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCueGrammar = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOAST_MS = 5000, CONFIRM_MS = 15000;
  var POS = { controlled: 1, risky: 1, desperate: 1 }, EFF = { limited: 1, standard: 1, great: 1 };
  var FILL = { and: 1, a: 1, an: 1, the: 1, is: 1, it: 1, as: 1, position: 1, effect: 1, at: 1, with: 1, then: 1, um: 1, uh: 1, okay: 1, ok: 1, please: 1, now: 1, to: 1, into: 1, phase: 1, on: 1, scene: 1, present: 1, mode: 1, our: 1, that: 1, this: 1 };
  var PHASE_W = { personal: 'pb', pb: 'pb', downtime: 'pb', planning: 'plan', plan: 'plan', briefing: 'plan', score: 'score', heist: 'score', aftermath: 'after', after: 'after', payout: 'after' };
  var PHASE_LABEL = { pb: 'Personal Business', plan: 'Planning', score: 'Score', after: 'Aftermath' };
  var VERBS = ['stamp', 'reveal', 'go', 'flashback', 'back', 'introduce', 'spotlight'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function norm(s) { return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function toks(s) { var out = [], re = /[A-Za-z0-9À-ɏ']+/g, m; s = str(s); while ((m = re.exec(s))) out.push({ w: m[0].toLowerCase().replace(/'/g, ''), s: m.index, e: m.index + m[0].length }); return out; }
  var TRAIL = /(?:[\s,.]+(?:um+|uh+|okay|ok|so|please))+[\s.?!]*$/i;
  function tidy(s, n) { return str(s).replace(TRAIL, '').replace(/^[\s,.:;\-–—]+|[\s,.:;\-–—!?]+$/g, '').replace(/\s+/g, ' ').slice(0, n || 100).trim(); }
  function act(a) { a.type = 'cue_do'; return { action: a }; }
  function unparsed() { return { refused: 'unparsed' }; }

  /* ---------- the parsers: ctx = { word, rest, words } (cue-verbs.js) ---------- */
  function parseStamp(ctx) {
    var first = str(ctx.word).toLowerCase(), t = toks(ctx.rest), pos = POS[first] ? first : '', eff = '', last = -1, i;
    for (i = 0; i < t.length; i++) {
      var w = t[i].w;
      if (!pos && POS[w]) { pos = w; last = i; continue; }
      if (!eff && EFF[w]) { eff = w; last = i; continue; }
      if (FILL[w] && (!pos || !eff)) continue;
      break;                                            /* the first other word opens the consequence (or, before both words are heard, makes the cue unparsed) */
    }
    if (!pos || !eff) return unparsed();
    var rest = last >= 0 ? str(ctx.rest).slice(t[last].e) : str(ctx.rest);
    var text = rest, again = true;
    while (again) { again = false; text = text.replace(/^[\s,.:;\-–—]+/, '').replace(/^(?:and|then|with|but|so|consequence|the consequence|threat|the threat|threatened|if it goes wrong|stakes)\b[\s,.:;\-–—]*/i, function () { again = true; return ''; }); }
    var out = { verb: 'stamp', position: pos, effect: eff }, line = tidy(text, 100);
    if (line) out.text = line;
    return act(out);
  }
  function onlyFiller(words, allow) { return words.every(function (w) { return FILL[w] || (allow && allow[w]); }); }
  function parseGo(ctx) {
    var ws = ctx.words || [], phase = '', i;
    for (i = 0; i < ws.length; i++) if (PHASE_W[ws[i]]) { phase = PHASE_W[ws[i]]; break; }
    if (!phase) return unparsed();
    if (!onlyFiller(ws, { personal: 1, business: 1, planning: 1, plan: 1, briefing: 1, score: 1, heist: 1, aftermath: 1, after: 1, payout: 1, pb: 1, downtime: 1 })) return unparsed();
    return act({ verb: 'go', phase: phase });
  }
  function parseBare(verb, allow) {
    return function (ctx) { return onlyFiller(ctx.words || [], allow) ? act({ verb: verb }) : unparsed(); };
  }
  /* the names after reveal / introduce / spotlight: the words of the original text (case kept), split on "and" and commas */
  function namesOf(rest, max) {
    var s = str(rest).replace(TRAIL, '').replace(/^[\s,.:;\-]+/, '').replace(/^(?:the|our|a|an)\s+/i, '').replace(/[.?!]+\s*$/, '');
    var parts = s.split(/\s*(?:,|;|\band\b|&)\s*/i).map(function (p) { return tidy(p.replace(/^(?:the|our)\s+/i, ''), 80); }).filter(Boolean);
    return parts.slice(0, max);
  }
  function parseNames(verb, max) {
    return function (ctx) {
      var names = namesOf(ctx.rest, max);
      if (!names.length || names.some(function (n) { return norm(n).length < 2; })) return unparsed();
      return act({ verb: verb, names: names });
    };
  }

  /* the registry's definitions; `enabled` is added by create() */
  function defs() {
    return [
      { id: 'stamp', words: ['stamp', 'risky', 'controlled', 'desperate'], label: 'Stamp', parse: parseStamp },
      { id: 'reveal', phrases: [['reveal']], label: 'Reveal', parse: parseNames('reveal', 1) },
      { id: 'go', words: ['go'], label: 'Go to a phase', parse: parseGo },
      { id: 'flashback', words: ['flashback'], label: 'Flashback', parse: parseBare('flashback', { flashback: 1 }) },
      { id: 'back', words: ['back'], label: 'Back from a flashback', parse: function (ctx) { return (ctx.words || [])[0] === 'on' ? unparsed() : parseBare('back')(ctx); } },
      { id: 'introduce', words: ['introduce', 'introducing'], label: 'Introduce', parse: parseNames('introduce', 6) },
      { id: 'spotlight', words: ['spotlight'], label: 'Spotlight', parse: parseNames('spotlight', 1) }
    ];
  }

  /* ---------- the controller ---------- */
  function create(host) {
    host = host || {};
    var registered = [], el = null, timer = null, toastSeq = 0, pending = null;
    function on() { return typeof host.feature === 'function' ? !!host.feature('ai.grammar') : false; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function clrT(h) { if (h == null) return; if (typeof host.clearTimeout === 'function') host.clearTimeout(h); else clearTimeout(h); }

    function register() {
      var cv = typeof host.cueVerbs === 'function' ? host.cueVerbs() : null;
      if (!cv || registered.length) return registered.slice();
      defs().forEach(function (d) {
        d.actionTypes = ['cue_do']; d.enabled = on;
        try { cv.register(d); registered.push(d.id); } catch (e) { /* a word or id another bundle owns: this verb is skipped, the rest still register */ }
      });
      return registered.slice();
    }
    function unregister() {
      var cv = typeof host.cueVerbs === 'function' ? host.cueVerbs() : null;
      registered.forEach(function (id) { if (cv) cv.unregister(id); });
      registered = [];
    }

    /* ---------- the toast with Undo ---------- */
    function hide() {
      if (pending) { var pn = pending; pending = null; pn(); }
      if (timer !== null) { clrT(timer); timer = null; }
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = null;
    }
    function undoToast(text, undo) {
      var doc = typeof host.doc === 'function' ? host.doc() : null;
      if (!on() || !doc || !doc.body) return null;
      hide();
      var mine = ++toastSeq;
      el = doc.createElement('div'); el.className = 'gm-ugtoast'; el.setAttribute('role', 'status');
      var t = doc.createElement('span'); t.className = 'gm-ugtoast-t'; t.textContent = str(text).slice(0, 160); el.appendChild(t);
      if (typeof undo === 'function') {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn sm gm-ugtoast-b'; b.textContent = 'Undo'; b.setAttribute('data-ug', 'undo');
        b.addEventListener('click', function () {
          if (mine !== toastSeq) return;
          if (timer !== null) { clrT(timer); timer = null; }
          b.disabled = true;
          Promise.resolve().then(undo).then(function (r) { if (mine === toastSeq && el) { t.textContent = r === false ? 'Could not undo that.' : 'Undone.'; if (b.parentNode) b.parentNode.removeChild(b); timer = setT(hide, 1500); } },
            function () { if (mine === toastSeq && el) { t.textContent = 'Could not undo that.'; timer = setT(hide, 2500); } });
        });
        el.appendChild(b);
      }
      doc.body.appendChild(el);
      timer = setT(function () { timer = null; if (mine === toastSeq) hide(); }, TOAST_MS);
      return el;
    }
    /* a question toast: Promise<boolean>, true only on the button. Cancel, a timeout, a newer toast or no screen to ask on all mean no. */
    function confirmToast(text, yesLabel) {
      var doc = typeof host.doc === 'function' ? host.doc() : null;
      if (!on() || !doc || !doc.body) return Promise.resolve(false);
      hide();
      return new Promise(function (resolve) {
        var mine = ++toastSeq, settled = false;
        function settle(v) { if (settled) return; settled = true; if (pending) pending = null; if (timer !== null) { clrT(timer); timer = null; } resolve(v); }
        var box = doc.createElement('div'); box.className = 'gm-ugtoast'; box.setAttribute('role', 'alertdialog'); el = box;
        var t = doc.createElement('span'); t.className = 'gm-ugtoast-t'; t.textContent = str(text).slice(0, 160); box.appendChild(t);
        var yes = doc.createElement('button'); yes.type = 'button'; yes.className = 'btn sm gm-ugtoast-b'; yes.textContent = yesLabel || 'Yes'; yes.setAttribute('data-ug', 'confirm');
        yes.addEventListener('click', function () { if (mine !== toastSeq) return settle(false); settle(true); });
        var no = doc.createElement('button'); no.type = 'button'; no.className = 'btn sm gm-ugtoast-b'; no.textContent = 'Cancel'; no.setAttribute('data-ug', 'cancel');
        no.addEventListener('click', function () { settle(false); if (mine === toastSeq) hide(); });
        box.appendChild(yes); box.appendChild(no);
        doc.body.appendChild(box);
        timer = setT(function () { timer = null; settle(false); if (mine === toastSeq) hide(); }, CONFIRM_MS);
        pending = function () { settle(false); };   /* hide() (a newer toast) answers no, so the question never hangs */
      });
    }
    function didntCatch() { if (on()) say('Didn’t catch that.', false); return false; }

    /* ---------- carrying a verb out ---------- */
    function matchNpc(name) {
      var n = norm(name), list = typeof host.npcs === 'function' ? host.npcs() : [], exact = [], part = [];
      list.forEach(function (p) {
        var full = norm(p.name), al = norm(p.alias || '');
        if (n && (full === n || (al && al === n))) exact.push(p);
        else if (n && full && full.split(' ').indexOf(n) >= 0) part.push(p);          /* a first or last name on its own */
      });
      var hit = exact.length ? exact : part;
      return hit.length === 1 ? { npc: hit[0] } : hit.length > 1 ? { many: true } : { none: true };
    }
    function resolve(names) {
      var out = [];
      for (var i = 0; i < names.length; i++) {
        var m = matchNpc(names[i]);
        if (m.npc) out.push(m.npc);
        else return { error: m.many ? 'More than one NPC matches ' + names[i] + '.' : 'No NPC called ' + names[i] + '.' };
      }
      return { npcs: out };
    }
    function done(say_, undo) { if (say_) undoToast(say_, undo); return { ok: true, say: say_ }; }
    function fail(msg) { say(msg, true); return { ok: false, say: msg }; }
    function clearIfMine(key) {
      if (typeof host.overlayId === 'function' && typeof host.keyFor === 'function' && host.overlayId() === host.keyFor(key) && typeof host.clearOverlay === 'function') return host.clearOverlay();
      return Promise.resolve(null);
    }

    var handlers = {
      stamp: function (a) {
        var st = typeof host.stamp === 'function' ? host.stamp() : null;
        if (!st) return Promise.resolve(fail('The stamp is not switched on.'));
        return st.stampNow(a.position, a.effect, a.text || '').then(function (ok) {
          if (!ok) return { ok: false, say: '' };
          return done('Stamped ' + a.position + ', ' + a.effect + '.', function () { return st.esc(); });
        });
      },
      reveal: function (a) {
        var r = resolve(a.names || []); if (r.error) return Promise.resolve(fail(r.error));
        var p = r.npcs[0];
        if (p.revealed) return Promise.resolve(fail(p.name + ' is already revealed.'));
        /* the GM is asked first (a spoken cue can mishear a name); only then does it fire, and the usual Undo follows the confirm */
        return confirmToast('Reveal ' + p.name + ' to the iPad?', 'Reveal').then(function (yes) {
          if (!yes) { hide(); return { ok: false, say: '' }; }
          return Promise.resolve(host.reveal(p.id, true)).then(function () { return done('Revealed ' + p.name + '.', function () { return host.reveal(p.id, false); }); },
            function () { return fail('Could not reveal ' + p.name + '.'); });
        });
      },
      go: function (a) {
        var nt = typeof host.night === 'function' ? host.night() : null;
        if (!nt) return Promise.resolve(fail('There is no night to move.'));
        var prev = nt.phase(), label = PHASE_LABEL[a.phase] || a.phase;
        if (prev === a.phase) return Promise.resolve(fail('Already in ' + label + '.'));
        if (nt.enter(a.phase) === false) return Promise.resolve(fail('Could not enter ' + label + '.'));
        return Promise.resolve(typeof host.layer === 'function' ? host.layer('band.phase', a.phase) : null).then(function () {
          return done('Now in ' + label + '.', function () {
            if (prev) { nt.enter(prev); return host.layer('band.phase', prev); }
            return host.layer('band.phase', null);
          });
        });
      },
      flashback: function () {
        var was = typeof host.layerValue === 'function' ? host.layerValue('scene.filter') : null;
        return Promise.resolve(host.layer('scene.filter', 'flashback')).then(function (r) {
          if (r === null) return { ok: false, say: '' };
          return done('Flashback on the iPad.', function () { return host.layer('scene.filter', was === 'flashback' ? 'flashback' : null); });
        });
      },
      back: function () {
        var was = typeof host.layerValue === 'function' ? host.layerValue('scene.filter') : null;
        if (was !== 'flashback') return Promise.resolve(fail('No flashback is up.'));
        return Promise.resolve(host.layer('scene.filter', null)).then(function (r) {
          if (r === null) return { ok: false, say: '' };
          return done('Back from the flashback.', function () { return host.layer('scene.filter', 'flashback'); });
        });
      },
      introduce: function (a) { return beat('rolodex', a, 'Introducing '); },
      spotlight: function (a) { return beat('spotlight', a, 'Spotlight on '); }
    };
    function beat(kind, a, lead) {
      var r = resolve(a.names || []); if (r.error) return Promise.resolve(fail(r.error));
      var hidden = r.npcs.filter(function (p) { return !p.revealed; });
      if (hidden.length) return Promise.resolve(fail(hidden[0].name + ' is not revealed yet: say “reveal” first.'));
      var key = 'cue-' + kind + '-' + (++toastSeq) + '-' + Date.now().toString(36), payload = kind === 'rolodex' ? { npcIds: r.npcs.map(function (p) { return p.id; }) } : { npcId: r.npcs[0].id };
      var opts = { key: key }; if (kind === 'rolodex' && typeof host.feature === 'function' && host.feature('face.rolodex')) opts.ms = 20000;     /* the lower third stays about 20 seconds (suite 3.5) */
      return Promise.resolve(host.show(kind, payload, opts)).then(function (res) {
        if (res === null || res === undefined) return { ok: false, say: '' };
        return done(lead + r.npcs.map(function (p) { return p.name; }).join(', ') + '.', function () { return clearIfMine(key); });
      });
    }
    /* a cue_do action (already through validateActions) -> Promise<{ ok, say }>. The switch is read here too: a cue that arrives with it off does nothing. */
    function run(action) {
      if (!on()) return Promise.resolve({ ok: false, say: '' });
      if (!isObj(action) || action.type !== 'cue_do' || !Object.prototype.hasOwnProperty.call(handlers, action.verb)) return Promise.resolve({ ok: false, say: '' });
      return Promise.resolve().then(function () { return handlers[action.verb](action); }).then(null, function () { return fail('That did not work.'); });
    }
    return { register: register, unregister: unregister, run: run, undoToast: undoToast, didntCatch: didntCatch, hide: hide, TOAST_MS: TOAST_MS };
  }

  return { VERBS: VERBS, TOAST_MS: TOAST_MS, parseStamp: parseStamp, parseGo: parseGo, namesOf: namesOf, defs: defs, create: create };
});
