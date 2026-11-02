/* cue-verbs.js — the cue's verb registry (suite ticket W0.5; A2 fills it).

   Pure code: no DOM, no clock, no network. Window.B68CueVerbs, and module.exports under Node. Loaded before cue.js in the gm and display bundles; cue.js asks
   it, at call time, for any command word it does not know itself (so the order of loading never matters, and a verb registered later is heard at once).

   A new spoken command is registered here, never written into cue.js's parser:
     register({ id, words, actionTypes, parse, label?, help? })
        id           lowercase letters, digits and dashes; not a verb cue.js already has
        words        the spoken words that open the command ("send"), lowercase, one token each; not a word cue.js already has (reserve() enforces both)
        phrases      (optional, B09) spoken openers of one or more words, each an array of lowercase words (["off", "the", "record"], ["reveal"]). A phrase is looked
                     for FIRST, at the command slot, and may start with a word cue.js owns ("reveal"): that is how a verb takes over a built-in word. The phrase's
                     first word is the command word parse() is given; the rest of the phrase is in ctx.words like everything else after it.
        enabled      (optional, B09) a function: the verb exists only while it returns true (a feature switch read live). With it false the verb is invisible to
                     verbFor, phraseAt, has and run, so the cue behaves exactly as if it were not registered.
        actionTypes  the action types parse may return. Each MUST also be in functions/_lib/assist/hands.js CUE_TYPES, or the Worker's validateActions drops it
                     (checks/runtime/gm-cue-verbs.test.mjs holds every registered verb to that)
        parse(ctx)   ctx = { id, word, text, rest, words, live, assume }: text the whole cue, rest the original text after the command word up to the end of its
                     sentence, words the lowercased words of rest, live cogmLive's shape, assume true when there is no table to read (find()).
                     -> { action }                        one action, { type, ...fields }, no key, no quote (cue.js adds the quote)
                      | { missing, candidates?, name?, draft? }   what the cue still needs (the page asks)
                      | { refused: 'unparsed' | 'nochange' | ... }
                      | null                               = refused 'unparsed'
   run() checks what parse returned: an action of a type the verb did not declare, or one that carries a `key` or a `quote`, becomes a refusal ('unparsed').
   Nothing a registered verb says goes to the server unless it is one of its declared action types, and the server validates those again.

   API
     register(def) -> the stored verb        unregister(id) -> bool       reset()
     reserve(words, ids)   cue.js tells the registry which words and ids are its own: a clash throws (now, or when a verb is registered later)
     verbFor(word) -> id | null     phraseAt(words) -> { id, n } | null     has(id) -> bool     get(id)     list() -> [{ id, words, actionTypes, label }]     words() -> [word]
     run(id, ctx) -> the checked result of parse(ctx) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68CueVerbs = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[a-z][a-z0-9-]{0,23}$/, WORD_RE = /^[a-z][a-z']{0,23}$/, TYPE_RE = /^[a-z][a-z_]{0,31}$/;
  var verbs = [], byWord = {}, reservedWords = {}, reservedIds = {};

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function reserve(words, ids) {
    (Array.isArray(words) ? words : []).forEach(function (w) { reservedWords[str(w).toLowerCase()] = true; });
    (Array.isArray(ids) ? ids : []).forEach(function (i) { reservedIds[str(i)] = true; });
    verbs.forEach(function (v) {
      if (reservedIds[v.id]) throw new Error('cue verb ' + v.id + ' clashes with a built-in verb');
      v.words.forEach(function (w) { if (reservedWords[w]) throw new Error('cue word "' + w + '" (verb ' + v.id + ') clashes with a built-in word'); });
    });
  }
  function get(id) { for (var i = 0; i < verbs.length; i++) if (verbs[i].id === id) return verbs[i]; return null; }
  function register(def) {
    if (!isObj(def)) throw new Error('a cue verb is an object');
    var id = str(def.id);
    if (!ID_RE.test(id)) throw new Error('cue verb id: lowercase letters, digits and dashes: ' + id);
    if (reservedIds[id] || get(id)) throw new Error('cue verb ' + id + ' already exists');
    var words = (Array.isArray(def.words) ? def.words : []).map(function (w) { return str(w).toLowerCase(); });
    if (!words.length && !(Array.isArray(def.phrases) && def.phrases.length)) throw new Error('cue verb ' + id + ' needs at least one word');
    words.forEach(function (w) {
      if (!WORD_RE.test(w)) throw new Error('cue verb ' + id + ': "' + w + '" is not a single lowercase word');
      if (reservedWords[w]) throw new Error('cue word "' + w + '" belongs to a built-in verb');
      if (has(byWord, w)) throw new Error('cue word "' + w + '" already belongs to ' + byWord[w]);
    });
    var types = Array.isArray(def.actionTypes) ? def.actionTypes.map(str) : [];
    if (!types.length || types.some(function (t) { return !TYPE_RE.test(t); })) throw new Error('cue verb ' + id + ' must declare its action types');
    if (typeof def.parse !== 'function') throw new Error('cue verb ' + id + ' needs parse(ctx)');
    var phrases = [];
    (Array.isArray(def.phrases) ? def.phrases : []).forEach(function (ph) {
      var p = (Array.isArray(ph) ? ph : []).map(function (w) { return str(w).toLowerCase(); });
      if (!p.length || p.some(function (w) { return !WORD_RE.test(w); })) throw new Error('cue verb ' + id + ': a phrase is one or more lowercase words');
      for (var i = 0; i < verbs.length; i++) for (var j = 0; j < verbs[i].phrases.length; j++) if (verbs[i].phrases[j].join(' ') === p.join(' ')) throw new Error('cue phrase "' + p.join(' ') + '" already belongs to ' + verbs[i].id);
      phrases.push(p);
    });
    if (def.enabled !== undefined && typeof def.enabled !== 'function') throw new Error('cue verb ' + id + ': enabled is a function');
    var v = { id: id, words: words, phrases: phrases, enabled: def.enabled, actionTypes: types, parse: def.parse, label: str(def.label) || id, help: str(def.help) };
    verbs.push(v);
    words.forEach(function (w) { byWord[w] = id; });
    return v;
  }
  function unregister(id) {
    var v = get(id); if (!v) return false;
    verbs.splice(verbs.indexOf(v), 1);
    v.words.forEach(function (w) { if (byWord[w] === id) delete byWord[w]; });
    return true;
  }
  function reset() { verbs = []; byWord = {}; }
  function isOn(v) { if (!v) return false; if (typeof v.enabled !== 'function') return true; try { return !!v.enabled(); } catch (e) { return false; } }
  function verbFor(word) { var w = str(word).toLowerCase(); if (!has(byWord, w)) return null; return isOn(get(byWord[w])) ? byWord[w] : null; }
  function hasVerb(id) { return isOn(get(id)); }
  /* the longest enabled phrase that opens ws (an array of lowercase words) -> { id, n } | null */
  function phraseAt(ws) {
    var best = null;
    if (!Array.isArray(ws) || !ws.length) return null;
    verbs.forEach(function (v) {
      if (!v.phrases.length || !isOn(v)) return;
      v.phrases.forEach(function (p) {
        if (p.length > ws.length || (best && best.n >= p.length)) return;
        for (var i = 0; i < p.length; i++) if (ws[i] !== p[i]) return;
        best = { id: v.id, n: p.length };
      });
    });
    return best;
  }
  function list() { return verbs.map(function (v) { return { id: v.id, words: v.words.slice(), actionTypes: v.actionTypes.slice(), label: v.label }; }); }
  function words() { return Object.keys(byWord).filter(function (w) { return isOn(get(byWord[w])); }); }

  function run(id, ctx) {
    var v = get(id);
    if (!v || !isOn(v)) return { refused: 'unparsed' };
    var out;
    try { out = v.parse(ctx || {}); } catch (e) { return { refused: 'unparsed' }; }
    if (!isObj(out)) return { refused: 'unparsed' };
    if (out.action !== undefined) {
      var a = out.action;
      if (!isObj(a) || v.actionTypes.indexOf(a.type) < 0 || has(a, 'key') || has(a, 'quote')) return { refused: 'unparsed' };
    }
    return out;
  }

  return { register: register, unregister: unregister, reset: reset, reserve: reserve, verbFor: verbFor, phraseAt: phraseAt, has: hasVerb, get: get, list: list, words: words, run: run };
});
