/* B68Cue: the cue (design "the cue and the phones" 1.3). Pure code: no DOM, no clock, no network, no storage.
   "Blade, make a six clock called Escape": find() says whether a text holds a cue, parse() turns it into the same action shapes hands.js takes
   (functions/_lib/assist/hands.js validateActions). The page (C4d) joins split lines, calls parse, and sends the result to the Worker (/act, mode 'cue').

   API (every function is also on B68Cue._pure)
     find(text) -> { index, word, verb } | { index, word, verb: null, pending: true } | null
        index: the offset of the wake word in the ORIGINAL string, so text.slice(index) is the quote. word: the wake word as heard.
        verb: the command, one of make tick mark fill clear plus call rename undo note loose name show sheet.
        pending: a bare "Blade" that starts a clause with nothing after it yet (C4b arms the merger on it). Only the word Blade itself arms: a mishearing counts only
        when a command word follows straight after it.
     parse(text, live) -> { actions, missing, candidates, refused, name, quote, cue, pending?, draft? }
        live is cogmLive's shape (gm-page.js): { clocks: [{ id, name, size, filled, hidden }], ... }, plus an OPTIONAL lastClock (an id, or { id }): the clock Blade last
        made or ticked within ten minutes, which the PAGE works out. Without it, "tick that" is missing 'which' with every clock as a candidate.
        actions: the hands.js shapes, with NO key (the Worker makes keys; the page never does) and every action carrying quote:
           { type: 'clock_add', name, size, hidden: true, filled?, quote }              (filled only when the cue said "and mark two")
           { type: 'clock_tick', clock_id, clock_name, by, quote }                       (by is signed: clear is negative, fill is the room left)
           { type: 'npc_add', name, look, role, needsName, quote }                       (no name heard: name is '' and needsName is TRUE; C4d rolls the name with the
                                                                                          NPC generator. A named NPC has needsName false)
           { type: 'capture', bucket: 'moment' | 'loose_end' | 'name', text, quote }
           { type: 'undo', quote }  { type: 'rename', name, quote }                      (ordinary actions: they go to the server like the rest; the page carries them out)
        quote: the text from the wake word to the end of the text parsed, exactly as given (case, punctuation). For a split command the page joins the two lines
        with joinLines(a, b) (ONE space) and parses the joined text, so the quote spans the join.
        missing: null, or what the cue still needs: 'which' (two or more clocks match: candidates [{ id, name }]), 'clock' (none matches: name is what was heard),
        'size' (candidates [4, 6, 8]), 'name', 'text', 'amount', 'more' ("Blade, make a six": cut off, so the page waits for the next line). When something is missing, actions is [] and draft holds what was understood.
        refused: null, or why the cue was not acted on: 'show' (anything that would show the players), 'sheet' (stress, harm, xp, coin), 'unparsed', 'nochange'.
        The page's grey card says: Heard "Blade, ...": I can't do that yet.
     joinLines(a, b) -> a, one space, b (trailing space off a, leading space off b)
     matchClock(spoken, clocks) -> the clocks the spoken name means (design 1.3, "Matching a clock name": exact; ignoring the, a, an; every word within one letter)
     numOf(word) -> the number a word stands for in a number slot (digits, one..twelve, and Deepgram's to/too/for/sick/ate/won) or null
   A number alias (to, too, for, won) is a number only in a number slot (before "segment" or "clock", after a tick verb, after "mark"), never in a name. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Cue = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var P = {};
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  /* what two names are compared as: the same rule as cogm.js and hands.js */
  function norm(s) { return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  P.norm = norm;

  var MIS = { blades: 1, blaid: 1, blayed: 1, played: 1, blake: 1, blaine: 1 };
  var FILLER = { okay: 1, ok: 1, right: 1, alright: 1, hey: 1, so: 1, um: 1, uh: 1 };
  var SKIP = { please: 1, just: 1, now: 1 };
  var MODAL = { can: 1, could: 1, would: 1, will: 1 };
  var CMD = {
    make: 'make', start: 'make', 'new': 'make', create: 'make', add: 'make',
    tick: 'tick', ticks: 'tick', tic: 'tick', tik: 'tick', tics: 'tick',
    mark: 'mark', marks: 'mark', fill: 'fill', clear: 'clear', plus: 'plus',
    call: 'call', rename: 'rename', undo: 'undo', scratch: 'undo', cancel: 'undo',
    note: 'note', loose: 'loose', name: 'name',
    show: 'show', reveal: 'show', display: 'show', put: 'show',
    stress: 'sheet', harm: 'sheet', xp: 'sheet', coin: 'sheet', coins: 'sheet', trauma: 'sheet'
  };
  var NAME_STOP = { is: 1, was: 1, of: 1, 'for': 1, a: 1, an: 1, 'the': 1, and: 1 };
  var NUMW = { one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, 'for': 4, five: 5, six: 6, sick: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  var SEGN = { segment: 1, segments: 1, segmented: 1, part: 1, parts: 1, piece: 1, pieces: 1, slice: 1, slices: 1, tick: 1, ticks: 1, section: 1, sections: 1, box: 1, boxes: 1 };
  var TAILN = { tick: 1, ticks: 1, segment: 1, segments: 1, time: 1, times: 1, box: 1, boxes: 1, mark: 1, marks: 1 };
  var PREP = { on: 1, to: 1, 'in': 1, of: 1, 'for': 1, off: 1, from: 1 };
  var ONCE = { once: 1, twice: 2, thrice: 3 };
  var PRON = { that: 1, it: 1, 'this': 1 };
  var SIZES = [4, 6, 8, 10, 12];
  var NPCW = { npc: 1, npcs: 1, enpc: 1, anpc: 1, empc: 1 };
  var FILLV = { mark: 1, marked: 1, tick: 1, ticked: 1, fill: 1, filled: 1, start: 1, starting: 1 };
  var NAME_MARK = { called: 1, named: 1, call: 1, cold: 1, titled: 1, labelled: 1, labeled: 1, 'for': 1 };
  var UM = { um: 1, umm: 1, uh: 1, uhh: 1, okay: 1, ok: 1 };
  var TRAIL_UM = /(?:[\s,.]+(?:um+|uh+|okay|ok|so))+[\s.?!]*$/i;      /* "...Night Ferry um" */
  var CLOCK_STOP = { 'with': 1, that: 1, which: 1, has: 1, where: 1, please: 1, thanks: 1, um: 1, umm: 1, uh: 1, uhh: 1, okay: 1, ok: 1 };
  var AND_STOP = { show: 1, reveal: 1, display: 1, add: 1, mark: 1, tick: 1, fill: 1, marked: 1, set: 1, start: 1, 'with': 1, put: 1, have: 1 };
  var SHOW_W = { show: 1, reveal: 1, display: 1 };
  var SHEET_W = { stress: 1, harm: 1, xp: 1, coin: 1, coins: 1, trauma: 1 };
  var MINOR = { of: 1, 'the': 1, a: 1, an: 1, and: 1, 'in': 1, on: 1, to: 1, at: 1, 'for': 1 };

  function numOf(w) {
    w = str(w).toLowerCase();
    if (/^\d{1,2}$/.test(w)) return +w;
    return Object.prototype.hasOwnProperty.call(NUMW, w) ? NUMW[w] : null;
  }
  P.numOf = numOf;
  function joinLines(a, b) {
    var x = str(a).replace(/\s+$/, ''), y = str(b).replace(/^\s+/, '');
    return !x ? y : !y ? x : x + ' ' + y;
  }
  P.joinLines = joinLines;

  /* ---------- tokens: words with their place in the ORIGINAL text ---------- */
  function tokenize(text) {
    var out = [], re = /\S+/g, m;
    while ((m = re.exec(text))) {
      var pieces = m[0].split(/([\-–—]+)/), off = m.index;
      for (var i = 0; i < pieces.length; i++) {
        var pc = pieces[i];
        if (pc && !/^[\-–—]+$/.test(pc)) {
          var w = pc.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          if (w) out.push({ w: w, s: off, e: off + pc.length, p: (pc.match(/[^\p{L}\p{N}]*$/u) || [''])[0], poss: /['’]s[^\p{L}\p{N}]*$/iu.test(pc) });
          else if (out.length) out[out.length - 1].p += pc;
        }
        off += pc.length;
      }
    }
    return out;
  }
  function span(toks, text, a, b) {
    if (a > b || a < 0 || b >= toks.length) return '';
    return text.slice(toks[a].s, toks[b].e).replace(/^[\s,.:;!?"'“”‘’\-–—]+|[\s,.:;!?"'“”‘’\-–—]+$/g, '').replace(/\s+/g, ' ');
  }
  function sentenceEnd(toks, from) {
    for (var k = from; k < toks.length; k++) if (/[.?!]/.test(toks[k].p)) return k;
    return toks.length - 1;
  }
  /* "Escape" -> "Escape"; "escape route" -> "Escape Route": a name heard in all lower case is given capitals, as the design's card shows */
  function nameCase(s) {
    s = str(s).replace(/\s+/g, ' ').trim().replace(TRAIL_UM, '').slice(0, 80);
    if (!s || s !== s.toLowerCase()) return s;
    return s.split(' ').map(function (w, i) { return i > 0 && MINOR[w] ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }

  /* ---------- 1. finding it ---------- */
  function clauseStart(toks, text, i) {
    if (i === 0) return true;
    var prev = toks[i - 1];
    if (/[.?!,;:]/.test(prev.p)) return true;
    if (/\n/.test(text.slice(prev.e, toks[i].s))) return true;
    return !!FILLER[prev.w];
  }
  /* the command word at toks[k], if there is one (with the two words that need a second look) */
  function cmdAt(toks, k) {
    var t = toks[k]; if (!t) return null;
    var v = Object.prototype.hasOwnProperty.call(CMD, t.w) ? CMD[t.w] : null;
    if (!v) return null;
    var n = toks[k + 1];
    if (v === 'loose') return n && (n.w === 'end' || n.w === 'ends') ? v : null;
    if (v === 'name') return t.p.indexOf(':') >= 0 || !n || !NAME_STOP[n.w] ? v : null;
    return v;
  }
  /* a command word within the next three words (skipping please, just, now and "can you") */
  function findVerb(toks, i) {
    var k = i + 1, count = 0;
    while (k < toks.length && count < 3) {
      var w = toks[k].w;
      if (SKIP[w] || UM[w]) { k++; continue; }
      if (MODAL[w] && toks[k + 1] && toks[k + 1].w === 'you') { k += 2; continue; }
      var v = cmdAt(toks, k);
      if (v) return { k: k, verb: v };
      count++; k++;
    }
    return null;
  }
  function onlyPoliteAfter(toks, i) {
    for (var k = i + 1; k < toks.length; k++) {
      var w = toks[k].w;
      if (SKIP[w] || UM[w]) continue;
      if (MODAL[w] && toks[k + 1] && toks[k + 1].w === 'you') { k++; continue; }
      if (w === 'you') continue;
      return false;
    }
    return true;
  }
  function locate(text, live) {
    var toks = tokenize(text), pending = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.poss) continue;                                        /* "Blade's name": a possessive, not a call */
      var real = t.w === 'blade', mis = Object.prototype.hasOwnProperty.call(MIS, t.w);
      if (!real && !mis) continue;
      if (!clauseStart(toks, text, i)) continue;
      var hit = null;
      if (mis) {
        /* a mishearing is quieter than the word: it counts only when the cue parses to an action (no missing, no refused). "can you" and "please" are skipped after it. */
        var k0 = i + 1;
        for (;;) {
          if (toks[k0] && SKIP[toks[k0].w]) k0++;
          else if (toks[k0] && MODAL[toks[k0].w] && toks[k0 + 1] && toks[k0 + 1].w === 'you') k0 += 2;
          else break;
        }
        var v = cmdAt(toks, k0);
        if (v) {
          var cand = { toks: toks, wi: i, vi: k0, verb: v }, got = run(text, isObj(live) ? live : {}, cand, !isObj(live));
          if (got.actions.length && !got.missing && !got.refused) hit = { k: k0, verb: v };
        }
        if (!hit) continue;
      }
      else hit = findVerb(toks, i);
      if (hit) return { toks: toks, wi: i, vi: hit.k, verb: hit.verb };
      if (real && !pending && onlyPoliteAfter(toks, i)) pending = { toks: toks, wi: i, vi: -1, verb: null, pending: true };
    }
    return pending;
  }
  function wakeWord(text, toks, i) { return text.slice(toks[i].s, toks[i].e).replace(/[^\p{L}\p{N}'’]+$/gu, ''); }
  function find(text, live) {
    text = str(text);
    var loc = locate(text, live); if (!loc) return null;
    var out = { index: loc.toks[loc.wi].s, word: wakeWord(text, loc.toks, loc.wi), verb: loc.verb };
    if (loc.pending) out.pending = true;
    return out;
  }
  P.find = find;

  /* ---------- 2. matching a clock name (design 1.3) ---------- */
  function noArt(n) { return n.split(' ').filter(function (w) { return w && w !== 'the' && w !== 'a' && w !== 'an'; }).join(' '); }
  function within1(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0; while (i < la && i < lb && a.charAt(i) === b.charAt(i)) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1);
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function uniq(list) { var seen = {}; return list.filter(function (c) { if (seen[c.id]) return false; seen[c.id] = 1; return true; }); }
  function matchClock(spoken, clocks) {
    var n = norm(spoken); clocks = (Array.isArray(clocks) ? clocks : []).filter(function (c) { return isObj(c) && str(c.id) && norm(c.name); });
    if (!n) return [];
    var hit = clocks.filter(function (c) { return norm(c.name) === n; });
    if (hit.length) return uniq(hit);
    var dn = noArt(n); if (!dn) return [];
    hit = clocks.filter(function (c) { return noArt(norm(c.name)) === dn; });
    if (hit.length) return uniq(hit);
    var sw = dn.split(' ');
    hit = clocks.filter(function (c) {
      var cw = noArt(norm(c.name)).split(' ');
      return sw.every(function (w) { return cw.some(function (x) { return x === w || (w.length >= 5 && x.length >= 5 && within1(w, x)); }); });
    });
    return uniq(hit);
  }
  P.matchClock = matchClock;

  /* ---------- 3. parsing it ---------- */
  function cands(list) { return list.map(function (c) { return { id: str(c.id), name: str(c.name) }; }); }

  function clockAdd(toks, text, vi, e) {
    var ci = -1, k;
    for (k = vi + 1; k <= e; k++) if (toks[k].w === 'clock' || toks[k].w === 'clocks') { ci = k; break; }
    var size = null, sizeSeen = false;
    for (k = vi + 1; k <= e && !sizeSeen; k++) {
      var n = numOf(toks[k].w); if (n === null) continue;
      var nx = toks[k + 1];
      if (nx && (SEGN[nx.w] || k + 1 === ci)) { size = n; sizeSeen = true; }
    }
    var ns = -1;
    for (k = ci + 1; k <= e; k++) if (NAME_MARK[toks[k].w]) { ns = k + 1; break; }
    if (ns < 0 && ci >= 0 && ci + 1 <= e && numOf(toks[ci + 1].w) === null && !SEGN[toks[ci + 1].w] && !CLOCK_STOP[toks[ci + 1].w] && toks[ci + 1].w !== 'and') ns = ci + 1;
    if (ns >= 0 && ns <= e && CLOCK_STOP[toks[ns].w]) ns = -1;
    var ne = -1;
    if (ns >= 0 && ns <= e) {
      ne = ns;
      for (k = ns + 1; k <= e && k < ns + 6; k++) {
        var w = toks[k].w, nw = toks[k + 1] ? toks[k + 1].w : '';
        if (/[,;]/.test(toks[k - 1].p)) break;
        if (CLOCK_STOP[w]) break;
        if (w === 'and' && AND_STOP[nw]) break;
        if (FILLV[w] && numOf(nw) !== null) break;
        ne = k;
      }
    }
    var name = ns >= 0 && ne >= ns ? nameCase(span(toks, text, ns, ne)) : '';
    var filled = null;
    for (k = (ne >= 0 ? ne + 1 : ci + 1); k <= e; k++) {
      var f = toks[k].w;
      if (FILLV[f]) {
        var j = k + 1; while (j <= e && (toks[j].w === 'at' || toks[j].w === 'on' || toks[j].w === 'by' || toks[j].w === 'it' || toks[j].w === 'in' || toks[j].w === 'with' || toks[j].w === 'of')) j++;
        if (j <= e && numOf(toks[j].w) !== null) { filled = numOf(toks[j].w); break; }
      } else if (numOf(f) !== null && toks[k + 1] && /^(?:filled|ticked|marked)$/.test(toks[k + 1].w)) { filled = numOf(f); break; }
    }
    var draft = { type: 'clock_add', name: name, size: size, filled: filled };
    if (!name) return { missing: 'name', draft: draft };
    if (SIZES.indexOf(size) < 0) return { missing: 'size', candidates: [4, 6, 8], draft: draft };
    var a = { type: 'clock_add', name: name, size: size, hidden: true };
    if (filled !== null && filled > 0) a.filled = Math.min(filled, size);
    return { action: a };
  }

  function npcAdd(toks, text, ni, e) {
    var k, name = '', nameEnd = ni, markSeen = false;
    for (k = ni + 1; k <= e; k++) if (toks[k].w === 'called' || toks[k].w === 'named') { markSeen = true; break; }
    if (markSeen) {
      var ns = k + 1, ne = -1;
      for (var j = ns; j <= e && j < ns + 5; j++) {
        var w = toks[j].w, nw = toks[j + 1] ? toks[j + 1].w : '';
        if (j > ns && /[,;]/.test(toks[j - 1].p)) break;
        if (/^(?:who|that|which|looks?|looking|with|he|she|they|please|thanks|um+|uh+|okay|ok)$/.test(w)) break;
        if (j > ns && (w === 'a' || w === 'an')) break;
        if (w === 'and' && /^(?:he|she|they|looks?|who|an?|with)$/.test(nw)) break;
        ne = j;
      }
      if (ne >= ns) { name = nameCase(span(toks, text, ns, ne)); nameEnd = ne; } else nameEnd = k;
    }
    var tail = nameEnd + 1 <= e ? text.slice(toks[nameEnd + 1].s, toks[e].e).replace(/\s+/g, ' ') : '';
    var look = '', role = '', m;
    var LOOK = /^[\s,]*(?:(?:and\s+)?(?:who|that|which|he|she|they)\s+)?(?:(?:is|are)\s+)?(?:looks?|looking)\s+(?:like|as)\s+(.*)$/i;
    var ROLE = /^[\s,]*(?:(?:and\s+)?(?:he|she|they|who|that)(?:'s|’s|\s+is|\s+are)?\s+)?(?:an?|the)\s+(.+)$/i;
    var SPLIT = /^(.*?)[,;]\s*(?:and\s+)?(?:(?:he|she|they|who)(?:'s|’s|\s+is|\s+are)?\s+)?(?:an?|the)\s+(.+)$/i;
    if ((m = LOOK.exec(tail))) {
      var lk = m[1], sp = SPLIT.exec(lk);
      look = sp ? sp[1] : lk; role = sp ? sp[2] : '';
    } else if ((m = ROLE.exec(tail))) role = m[1];
    var clean = function (s, n) { return s.replace(TRAIL_UM, '').replace(/^[\s,.:;!?"'“”‘’\-–—]+|[\s,.:;!?"'“”‘’\-–—]+$/g, '').replace(/\s+/g, ' ').slice(0, n); };
    return { action: { type: 'npc_add', name: name, look: clean(look, 200), role: clean(role, 80), needsName: !name } };
  }

  /* the words of a tick cue -> { pron, spoken, amount, alt } */
  function tickArgs(toks, text, a, b) {
    var r = [], i;
    for (i = a; i <= b; i++) r.push(i);
    var amount = null, lead = 0;
    var w0 = r.length ? toks[r[0]].w : '', n0 = numOf(w0);
    if (r.length >= 3 && w0 === 'a' && TAILN[toks[r[1]].w] && PREP[toks[r[2]].w]) { amount = 1; lead = 3; }
    else if (r.length >= 2 && n0 !== null && PREP[toks[r[1]].w]) { amount = n0; lead = 2; }
    else if (r.length >= 3 && n0 !== null && TAILN[toks[r[1]].w] && PREP[toks[r[2]].w]) { amount = n0; lead = 3; }
    r = r.slice(lead);
    var out = { pron: false, spoken: '', amount: amount, alt: null };
    if (!r.length) { out.pron = true; return out; }
    var first = toks[r[0]].w;
    var strip = function (list) {          /* the trailing amount: once / twice / "by two" / "two ticks" */
      var e = list.length, amt = null, w;
      if (!e) return { list: list, amt: null };
      w = toks[list[e - 1]].w;
      if (ONCE[w]) return { list: list.slice(0, e - 1), amt: ONCE[w] };
      var k = e; if (TAILN[w]) k--;
      if (k > 0 && numOf(toks[list[k - 1]].w) !== null) { amt = numOf(toks[list[k - 1]].w); k--; if (k > 0 && toks[list[k - 1]].w === 'by') k--; return { list: list.slice(0, k), amt: amt }; }
      return { list: list, amt: null };
    };
    if (PRON[first]) {
      out.pron = true;
      var st = strip(r.slice(1)); if (st.amt !== null && amount === null) out.amount = st.amt;
      else if (r.length === 2 && numOf(toks[r[1]].w) !== null && amount === null) out.amount = numOf(toks[r[1]].w);
      return out;
    }
    out.spoken = span(toks, text, r[0], r[r.length - 1]);
    var s2 = strip(r);
    if (s2.amt !== null && s2.list.length) out.alt = { spoken: span(toks, text, s2.list[0], s2.list[s2.list.length - 1]), amount: amount === null ? s2.amt : amount };
    else if (s2.amt !== null) { out.pron = true; if (amount === null) out.amount = s2.amt; }
    return out;
  }

  function resolveTick(args, live, mode, assume) {
    var clocks = Array.isArray(live.clocks) ? live.clocks : [];
    var hits, spoken = args.spoken, amount = args.amount;
    if (args.pron) {
      var lc = isObj(live.lastClock) ? str(live.lastClock.id) : str(live.lastClock);
      hits = lc ? clocks.filter(function (c) { return str(c.id) === lc; }) : [];
      if (!hits.length) return { missing: 'which', candidates: cands(clocks), draft: { type: 'clock_tick', by: amount } };
      spoken = hits[0].name;
    } else if (assume) {
      /* no table to read (find without live): a short name that is not a possessive or 'some' counts as a clock */
      if (!spoken || spoken.split(/\s+/).length > 3 || /^(?:your|my|his|her|their|our|some|any|this|these|those)\b/i.test(spoken)) return { missing: 'clock', name: spoken };
      hits = [{ id: '?', name: spoken, size: 12, filled: 0 }];
    } else {
      hits = matchClock(spoken, clocks);
      if (!hits.length && args.alt) {
        var h2 = matchClock(args.alt.spoken, clocks);
        if (h2.length) { hits = h2; spoken = args.alt.spoken; amount = args.alt.amount; }
      }
      if (!hits.length) return { missing: 'clock', name: spoken, draft: { type: 'clock_tick', by: amount } };
      if (hits.length > 1) return { missing: 'which', candidates: cands(hits), name: spoken, draft: { type: 'clock_tick', by: amount } };
    }
    var c = hits[0], size = Math.max(1, Math.floor(+c.size) || 1), cur = Math.max(0, Math.min(size, Math.floor(+c.filled) || 0));
    var by;
    if (mode === 'fill') { by = size - cur; if (by === 0) return { refused: 'nochange' }; }
    else if (mode === 'clear') { if (amount === null) return { missing: 'amount', draft: { type: 'clock_tick', clock_id: str(c.id), clock_name: str(c.name) } }; by = -Math.min(12, amount); }
    else by = Math.min(12, amount === null ? 1 : amount);
    if (by === 0) return { refused: 'nochange' };
    return { action: { type: 'clock_tick', clock_id: str(c.id), clock_name: str(c.name), by: by } };
  }

  function parse(text, live) {
    text = str(text);
    var loc = locate(text, live);
    return run(text, isObj(live) ? live : {}, loc, false);
  }
  function run(text, live, loc, assume) {
    var res = { actions: [], missing: null, candidates: [], refused: null, name: '', quote: '', cue: null };
    if (!loc) return res;
    var toks = loc.toks, wi = loc.wi;
    res.cue = { index: toks[wi].s, word: wakeWord(text, toks, wi), verb: loc.verb };
    res.quote = text.slice(toks[wi].s).replace(/\s+$/, '');
    if (loc.pending) { res.pending = true; return res; }
    var vi = loc.vi, verb = loc.verb, e = sentenceEnd(toks, vi), k, out = null;
    var words = function (a, b) { var l = []; for (var i = a; i <= b; i++) l.push(toks[i].w); return l; };
    var capture = verb === 'note' || verb === 'loose' || verb === 'name';
    if (!capture && verb !== 'undo' && verb !== 'rename' && verb !== 'call') {
      /* show and sheet words refuse only OUTSIDE a clock's name: "a clock called Stress Test", "tick Coin Toss" */
      var inName = {}, mk, ix, cw, j2, okc;
      if (verb === 'make') {
        for (mk = vi + 1; mk <= e; mk++) if (NAME_MARK[toks[mk].w]) {
          for (ix = mk + 1; ix <= e; ix++) {
            if (ix > mk + 1 && /[,;]/.test(toks[ix - 1].p)) break;
            if (CLOCK_STOP[toks[ix].w] || (toks[ix].w === 'and' && toks[ix + 1] && AND_STOP[toks[ix + 1].w])) break;
            inName[ix] = 1;
          }
          break;
        }
      } else {
        (Array.isArray(live.clocks) ? live.clocks : []).forEach(function (c) {
          cw = norm(c.name).split(' ');
          for (ix = vi + 1; ix + cw.length - 1 <= e; ix++) {
            okc = true; for (j2 = 0; j2 < cw.length; j2++) if (toks[ix + j2].w !== cw[j2]) { okc = false; break; }
            if (okc) for (j2 = 0; j2 < cw.length; j2++) inName[ix + j2] = 1;
          }
        });
      }
      var any = []; for (ix = wi + 1; ix <= e; ix++) any.push(inName[ix] ? '' : toks[ix].w);
      if (verb === 'show' || any.some(function (w) { return SHOW_W[w]; }) || (any.indexOf('put') >= 0 && any.indexOf('up') >= 0)) { res.refused = 'show'; return res; }
      if (verb === 'sheet' || any.some(function (w) { return SHEET_W[w]; })) { res.refused = 'sheet'; return res; }
    }
    if (verb === 'undo') {
      var rest = words(vi + 1, e).filter(function (w) { return !/^(?:that|it|this|the|last|one|thing|action|please)$/.test(w) && !UM[w]; });
      out = rest.length ? { refused: 'unparsed' } : { action: { type: 'undo' } };
    } else if (verb === 'rename' || verb === 'call') {
      k = vi + 1;
      var pro = k <= e && /^(?:that|it|him|her|them|this)$/.test(toks[k].w);
      if (verb === 'call' && !pro) out = { refused: 'unparsed' };
      else {
        if (pro) k++;
        if (k + 1 <= e && toks[k].w === 'the' && /^(?:last|npc|clock)$/.test(toks[k + 1].w)) { k++; while (k <= e && /^(?:last|npc|clock|one)$/.test(toks[k].w)) k++; }
        if (k <= e && (toks[k].w === 'to' || toks[k].w === 'as')) k++;
        var nm = nameCase(span(toks, text, k, e));
        out = nm ? { action: { type: 'rename', name: nm } } : { missing: 'name', draft: { type: 'rename' } };
      }
    } else if (capture) {
      k = vi + 1; if (verb === 'loose') k++;
      var body = k < toks.length ? text.slice(toks[k].s).replace(/\s+/g, ' ').replace(/^[\s,:;\-–—]+|\s+$/g, '').replace(TRAIL_UM, '').replace(/\.+$/, '').slice(0, 300) : '';
      var bucket = verb === 'note' ? 'moment' : verb === 'loose' ? 'loose_end' : 'name';
      out = body ? { action: { type: 'capture', bucket: bucket, text: body } } : { missing: 'text', draft: { type: 'capture', bucket: bucket } };
    } else if (verb === 'make') {
      var ni = -1, ci = -1;
      for (k = vi + 1; k <= e; k++) {
        if (ni < 0 && (NPCW[toks[k].w] || (toks[k].w === 'n' && toks[k + 1] && toks[k + 1].w === 'p' && toks[k + 2] && toks[k + 2].w === 'c'))) ni = k;
        if (ci < 0 && (toks[k].w === 'clock' || toks[k].w === 'clocks')) ci = k;
      }
      if (ni >= 0 && (ci < 0 || ni < ci)) out = npcAdd(toks, text, toks[ni].w === 'n' ? ni + 2 : ni, e);
      else if (ci >= 0) out = clockAdd(toks, text, vi, e);
      else {
        /* "Blade, make a six" and nothing more: the command is cut off (the page joins the next line), not refused */
        var cut = words(vi + 1, e).every(function (w) { return /^(?:a|an|and|the|new|segment|segments|clock)$/.test(w) || UM[w] || numOf(w) !== null; });
        out = cut ? { missing: 'more', draft: { type: 'make' } } : { refused: 'unparsed' };
      }
    } else if (verb === 'plus') {
      var sa = wi + 1, sb = vi - 1;
      while (sa <= sb && (SKIP[toks[sa].w] || UM[toks[sa].w])) sa++;
      var amt = 1, q = vi + 1; if (q <= e && numOf(toks[q].w) !== null) amt = numOf(toks[q].w); else if (q <= e && ONCE[toks[q].w]) amt = ONCE[toks[q].w];
      var spoken = sa <= sb ? span(toks, text, sa, sb) : '';
      out = resolveTick({ pron: !spoken || (sb - sa === 0 && PRON[toks[sa].w]), spoken: spoken, amount: amt, alt: null }, live, 'tick', assume);
    } else if (verb === 'tick' || verb === 'mark' || verb === 'fill' || verb === 'clear') {
      var te = e; while (te > vi && UM[toks[te].w]) te--;
      out = resolveTick(tickArgs(toks, text, vi + 1, te), live, verb === 'fill' ? 'fill' : verb === 'clear' ? 'clear' : 'tick', assume);
    } else out = { refused: 'unparsed' };

    if (out.action) { out.action.quote = res.quote; res.actions.push(out.action); }
    if (out.missing) { res.missing = out.missing; res.candidates = out.candidates || []; res.name = out.name || ''; if (out.draft) res.draft = out.draft; }
    if (out.refused) res.refused = out.refused;
    return res;
  }
  P.parse = parse;

  /* C4f: a typed command in the Ask bar -> the cue sentence it stands for (the ONE place the slash forms are mapped). "Blade, ..." goes as typed.
     -> null (not a typed command: it is a question) | { text } (post this as the cue line) | { unknown: '/word' } (a grey card, nothing posted) */
  function fromTyped(input) {
    var s = str(input).replace(/\s+/g, ' ').trim(), m;
    if (/^blade\s*,/i.test(s)) return { text: s };
    if (s.charAt(0) !== '/') return null;
    m = /^\/([A-Za-z]+)\s*(.*)$/.exec(s);
    var cmd = m ? m[1].toLowerCase() : '', rest = m ? m[2].trim() : '', c;
    if (cmd === 'tick' && rest) return { text: 'Blade, tick ' + rest };
    if (cmd === 'clock' && rest) { c = /^(\d{1,2})\s+(.+)$/.exec(rest); return { text: c ? 'Blade, make a ' + c[1] + ' clock called ' + c[2] : 'Blade, make a clock called ' + rest }; }
    if (cmd === 'npc') return { text: rest ? 'Blade, new NPC called ' + rest : 'Blade, new NPC' };
    if (cmd === 'note' && rest) return { text: 'Blade, note ' + rest };
    if (cmd === 'undo' && !rest) return { text: 'Blade, undo' };
    return { unknown: m ? '/' + m[1] : s.slice(0, 40) };
  }

  var M = { find: find, parse: parse, fromTyped: fromTyped, joinLines: joinLines, matchClock: matchClock, numOf: numOf, norm: norm, SIZES: SIZES.slice(), _pure: P };
  return M;
});
