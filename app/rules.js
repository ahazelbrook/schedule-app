/* rules.js — the rules wiki (RULES.md): #rules (search and the index of the books) and #rules/<book>/<slug> (one entry),
   the GM's importer for a folder of Obsidian notes, and a small editor for house rules.
   The text of the rulebooks never lives in this repository: the GM imports it from their own PC into the hosted database
   (window.claude.rules, runtime/cf.js; CONTRACT.md) and every signed-in member reads it from there. The page keeps the
   last corpus it loaded in IndexedDB (per user), so search works offline and the next page load starts from it.
   Without window.claude.rules (the claude.ai artifact build) the page says the rules live on the hosted app.

   window.B68Rules:
     available()                  true when the runtime has a rules API (the "?" links are only drawn then)
     help(term)                   HTML for a small "?" link to #rules?q=<term> ('' when unavailable); term goes through KEYWORDS
     open(root, api)              draw into `root` for the current hash (boot.js calls it when the mode becomes `rules`)
     route()                      the hash changed inside the mode
     close()
   api (boot.js): { ready() -> Promise, isGM() -> bool, me() -> id|null, back() }
   Markdown is rendered by markdown.js (B68Markdown), which escapes all HTML; nothing here sets innerHTML from rule text
   except through it or esc(). */
(function () {
  'use strict';
  var M = window.B68Markdown;
  var BOOKS = { b68: 'Blades \u201968', bitd: 'Blades in the Dark', house: 'House rules' };
  var ORDER = ['b68', 'house', 'bitd'];                       /* which book an entry is shown from first */
  var PRI = { b68: 0, house: 1, bitd: 2 };
  /* the server's caps (functions/_lib/rules.js, LIMITS); the importer splits to fit them */
  var LIMITS = { chunkBytes: 300000, chunkEntries: 100, bookEntries: 4000, bookBytes: 8 * 1024 * 1024 };
  var SUFFIX = 'Blades \u201968';
  var PAGE = 40;                                              /* search results per page */

  /* the "?" links: what the sheets say -> what to search for */
  var KEYWORDS = {
    'indulge vice': 'indulge vice', 'vice': 'vice', 'recover': 'recover', 'repair': 'recover', 'long-term project': 'long-term project',
    'train': 'train', 'personal business': 'personal business', 'downtime': 'downtime',
    'stress': 'stress', 'trauma': 'trauma', 'clock': 'clock', 'clocks': 'clock',
    'heat': 'heat', 'wanted': 'wanted level', 'wanted level': 'wanted level', 'stacks': 'stacks coin', 'coin': 'coin'
  };

  var root = null, api = null, active = false;
  var S = { corpus: null, status: 'idle', error: '', offline: false, checkedAt: 0, q: '', shown: PAGE, pending: null, busy: false, token: 0 };

  /* ---------- small helpers ---------- */
  var esc = M.esc, norm = M.norm;
  function $(id) { return document.getElementById(id); }
  function runtime() { var c = window.claude; return c && c.rules && typeof c.rules.list === 'function' ? c.rules : null; }
  function isGM() { try { return !!(api && api.isGM && api.isGM()); } catch (e) { return false; } }
  function userKey() { var id = null; try { id = api && api.me && api.me(); } catch (e) {} return 'corpus:' + (id || 'anon'); }
  function utf8len(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return unescape(encodeURIComponent(s)).length; } }
  function hrefOf(e) { return '#rules/' + e.book + '/' + e.slug; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function when(ms) { var d = new Date(ms); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function slugify(s) {
    var t = String(s).toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'entry';
  }
  /* lower case, accents folded one character for one (so a position in the folded text is a position in the original) */
  function fold(s) {
    return String(s).replace(/[\u00c0-\u017f]/g, function (c) { try { return c.normalize('NFD').charAt(0); } catch (e) { return c; } }).toLowerCase();
  }

  /* ---------- the "?" links ---------- */
  function available() { return !!runtime(); }
  function help(term) {
    if (!available()) return '';
    var key = String(term).toLowerCase(), q = KEYWORDS[key] || term;
    return '<a class="rl-q" href="#rules?q=' + encodeURIComponent(q) + '" title="Look up \u201c' + esc(term) + '\u201d in the rules" aria-label="Rules: ' + esc(term) + '">?</a>';
  }

  /* ---------- the offline copy: IndexedDB, every call may fail (private mode, blocked storage) ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var r = window.indexedDB.open('b68-rules', 1);
        r.onupgradeneeded = function () { try { r.result.createObjectStore('kv'); } catch (e) {} };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
        r.onblocked = function () { rej(new Error('blocked')); };
      } catch (e) { rej(e); }
    });
  }
  function cacheGet() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        try { var q = db.transaction('kv', 'readonly').objectStore('kv').get(userKey()); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); }
      });
    }).catch(function () { return null; });
  }
  function cachePut(val) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, userKey()); tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { res(false); }; } catch (e) { res(false); }
      });
    }).catch(function () { return false; });
  }

  /* ---------- the corpus and its indexes ---------- */
  /* r: { version, updatedAt, entries } as the API sends it (or as cached) */
  function setCorpus(r, fromCache, savedAt) {
    var entries = (r.entries || []).filter(function (e) { return e && BOOKS[e.book] && e.slug; });
    var c = { version: r.version, updatedAt: r.updatedAt, entries: entries, fromCache: !!fromCache, savedAt: savedAt || Date.now(), byId: {}, byBook: { b68: [], bitd: [], house: [] }, bySrc: {}, titleKey: { b68: {}, bitd: {}, house: {} }, fileKey: { b68: {}, bitd: {}, house: {} }, groups: {} };
    entries.sort(function (a, b) { return PRI[a.book] - PRI[b.book] || a.ord - b.ord || (a.slug < b.slug ? -1 : 1); });
    entries.forEach(function (e) {
      e._p = M.plain(e.body);
      e._b = fold(e._p);
      e._t = fold(e.title + '\n' + (e.keys || '').replace(/\n/g, ' '));
      e._tr = fold(e.trail || '');
      e._n = norm(e.title);
      c.byId[e.book + '/' + e.slug] = e;
      c.byBook[e.book].push(e);
      if (e._n) (c.groups[e._n] = c.groups[e._n] || []).push(e);
      if (!c.titleKey[e.book][e._n]) c.titleKey[e.book][e._n] = e;
      if (e.src) {
        var sk = e.book + '|' + e.src;
        if (!c.bySrc[sk]) {                                    /* the first entry of a file stands for the file: [[File name]] and its aliases */
          c.bySrc[sk] = [];
          var base = norm(e.src.split('/').pop().replace(/\.md$/i, ''));
          if (base && !c.fileKey[e.book][base]) c.fileKey[e.book][base] = e;
          (e.keys || '').split('\n').forEach(function (k) { var n = norm(k); if (n && !c.fileKey[e.book][n]) c.fileKey[e.book][n] = e; });
        }
        c.bySrc[sk].push(e);
      }
    });
    S.corpus = c;
    return c;
  }

  function fetchRules() {
    var rt = runtime();
    if (!rt) return Promise.reject(new Error('unavailable'));
    return rt.list(S.corpus ? { version: S.corpus.version } : undefined).then(function (r) {
      S.checkedAt = Date.now();
      if (r && r.unchanged && S.corpus) { S.corpus.fromCache = false; S.offline = false; return S.corpus; }
      if (!r || !Array.isArray(r.entries)) throw new Error('the server sent something unexpected');
      var now = Date.now();
      /* a plain copy now: the write happens after the database opens, by when setCorpus has added its search fields to the entries */
      cachePut({ version: r.version, updatedAt: r.updatedAt, savedAt: now, entries: r.entries.map(function (e) { return { book: e.book, slug: e.slug, title: e.title, trail: e.trail, keys: e.keys, body: e.body, ord: e.ord, src: e.src, updatedAt: e.updatedAt }; }) });
      S.offline = false;
      return setCorpus(r, false, now);
    });
  }

  /* open: show what this device has at once, then ask the server whether it is still current */
  function load(force) {
    var token = ++S.token;
    if (!runtime()) { S.status = 'unavailable'; draw(); return; }
    if (!force && S.corpus && Date.now() - S.checkedAt < 20000) { S.status = 'ready'; draw(); return; }
    var have = !!S.corpus;
    if (!have) { S.status = 'loading'; draw(); }
    var local = have ? Promise.resolve() : cacheGet().then(function (c) {
      if (token !== S.token || !c || !Array.isArray(c.entries) || S.corpus) return;
      setCorpus(c, true, c.savedAt);
      S.status = 'ready'; draw();
    });
    local.then(function () { return fetchRules(); }).then(function () {
      if (token !== S.token) return;
      S.status = 'ready'; S.error = ''; draw();
    }, function (e) {
      if (token !== S.token) return;
      if (S.corpus) { S.offline = !!(e && e.network); S.status = 'ready'; if (!S.offline) S.error = e && e.message || 'could not check for updates'; }
      else { S.status = 'error'; S.error = e && e.status === 401 ? 'Sign in to read the rules.' : (e && e.network ? 'You are offline and this device has no saved copy of the rules yet. Open this page once while online.' : (e && e.message) || 'The rules could not be loaded.'); }
      draw();
    });
  }

  /* ---------- wikilinks ---------- */
  /* [[Page]] / [[Page#Heading]] -> the entry of that title or file name: this book first, then any */
  function resolver(book) {
    return function (page, frag) {
      var c = S.corpus; if (!c) return null;
      var key = norm(String(page).replace(/^.*\//, '').replace(/\.md$/i, '')), order = [book].concat(ORDER.filter(function (b) { return b !== book; }));
      for (var i = 0; i < order.length; i++) {
        var b = order[i], e = c.fileKey[b][key] || c.titleKey[b][key];
        if (!e) continue;
        if (frag && frag.charAt(0) !== '^') {
          var fk = norm(frag), sib = (c.bySrc[e.book + '|' + e.src] || []).filter(function (x) { return x._n === fk; })[0];
          if (sib) e = sib;
        }
        return { href: hrefOf(e) };
      }
      return null;
    };
  }

  /* ---------- search ---------- */
  function stemOf(w) {
    if (w.length > 6 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function termsOf(q) {
    var seen = {}, out = [];
    fold(q).split(/[^a-z0-9\u0080-\uffff]+/).forEach(function (w) { if (w.length > 1 || /^\d$/.test(w)) { var s = stemOf(w); if (s && !seen[s]) { seen[s] = 1; out.push(s); } } });
    return out;
  }
  function isWordChar(code) { return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code > 127; }
  /* index of the first word in `hay` that starts with `stem`, or -1 */
  function find(hay, stem, from) {
    var i = from || 0;
    for (;;) {
      i = hay.indexOf(stem, i);
      if (i < 0) return -1;
      if (i === 0 || !isWordChar(hay.charCodeAt(i - 1))) return i;
      i++;
    }
  }
  function count(hay, stem, cap) { var n = 0, i = -1; while (n < cap && (i = find(hay, stem, i + 1)) >= 0) n++; return n; }

  function scoreOf(e, terms, phrase, all) {
    var s = 0, hit = 0, i, t;
    for (i = 0; i < terms.length; i++) {
      t = terms[i];
      var inT = find(e._t, t), inR = find(e._tr, t), nB = count(e._b, t, 6), got = 0;
      if (inT >= 0) { s += 100 + (inT === 0 ? 15 : 0); got = 1; }
      if (inR >= 0) { s += 40; got = 1; }
      if (nB) { s += 10 + nB * 2; got = 1; }
      hit += got;
    }
    if (all ? hit < terms.length : !hit) return 0;
    if (!all) s = s / 2;
    if (terms.length > 1) {
      if (e._t.indexOf(phrase) >= 0) s += 150;
      if (e._tr.indexOf(phrase) >= 0) s += 40;
      if (e._b.indexOf(phrase) >= 0) s += 30;
    }
    if (norm(e.title) === norm(phrase)) s += 300;
    return s;
  }

  /* -> [{ primary, members: [entry, entry...] (primary first), score }]: one hit per title, Blades ’68 first */
  function search(q) {
    var c = S.corpus, terms = termsOf(q);
    if (!c || !terms.length) return { terms: terms, hits: [] };
    var phrase = fold(q).replace(/[^a-z0-9\u0080-\uffff]+/g, ' ').trim();
    var scored = [], pass, all;
    for (pass = 0; pass < 2 && !scored.length; pass++) {
      all = pass === 0;
      c.entries.forEach(function (e) { var s = scoreOf(e, terms, phrase, all); if (s) scored.push({ e: e, s: s }); });
    }
    var groups = {}, order = [];
    scored.forEach(function (x) {
      var k = x.e._n || x.e.book + '/' + x.e.slug, g = groups[k];
      if (!g) { g = groups[k] = { key: k, items: [], score: 0 }; order.push(g); }
      g.items.push(x); if (x.s > g.score) g.score = x.s;
    });
    var hits = order.map(function (g) {
      g.items.sort(function (a, b) { return PRI[a.e.book] - PRI[b.e.book] || a.e.ord - b.e.ord; });
      var members = (c.groups[g.key] || g.items.map(function (x) { return x.e; })).slice();
      if (!members.length) members = g.items.map(function (x) { return x.e; });
      /* the card is the first entry of the title (Blades \u201968 first); the others fold beneath it */
      return { primary: members[0], members: members, score: g.score };
    });
    hits.sort(function (a, b) { return b.score - a.score || PRI[a.primary.book] - PRI[b.primary.book] || a.primary.ord - b.primary.ord; });
    return { terms: terms, hits: hits };
  }

  /* text with the matched words wrapped in <mark>, everything escaped */
  function highlight(text, terms) {
    var hay = fold(text), spans = [];
    terms.forEach(function (t) {
      var i = -1;
      while ((i = find(hay, t, i + 1)) >= 0) { var j = i + t.length; while (j < hay.length && isWordChar(hay.charCodeAt(j))) j++; spans.push([i, j]); i = j - 1; }
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', at = 0;
    spans.forEach(function (s) {
      if (s[1] <= at) return;
      var from = Math.max(s[0], at);
      out += esc(text.slice(at, from)) + '<mark>' + esc(text.slice(from, s[1])) + '</mark>'; at = s[1];
    });
    return out + esc(text.slice(at));
  }
  function snippet(e, terms) {
    var p = e._p, pos = -1, len = 170;
    if (p.length !== e._b.length) return esc(p.slice(0, len));
    terms.forEach(function (t) { var i = find(e._b, t); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
    var start = pos < 0 ? 0 : Math.max(0, pos - 55);
    if (start > 0) { var sp = p.indexOf(' ', start); if (sp >= 0 && sp < pos) start = sp + 1; }
    var end = Math.min(p.length, start + len);
    if (end < p.length) { var ep = p.lastIndexOf(' ', end); if (ep > start + 60) end = ep; }
    return (start > 0 ? '\u2026' : '') + highlight(p.slice(start, end), terms) + (end < p.length ? '\u2026' : '');
  }
  function trailText(e) { return (e.trail || '').split(' > ').filter(Boolean).join(' \u203a '); }

  function hitHtml(h, terms) {
    var e = h.primary, twins = h.members.filter(function (m) { return m !== e; });
    var html = '<li class="rl-hit"><a class="rl-hit-title" href="' + hrefOf(e) + '">' + highlight(e.title, terms) + '</a> <span class="rl-book" data-book="' + e.book + '">' + esc(BOOKS[e.book]) + '</span>' +
      (e.trail ? '<span class="rl-hit-trail">' + esc(trailText(e)) + '</span>' : '') + '<p class="rl-snip">' + snippet(e, terms) + '</p>';
    twins.forEach(function (t) {
      html += '<details class="rl-twin"><summary>' + esc(twinLabel(t.book)) + '</summary><a href="' + hrefOf(t) + '">' + highlight(t.title, terms) + '</a><p class="rl-snip">' + snippet(t, terms) + '</p></details>';
    });
    return html + '</li>';
  }
  function twinLabel(book) { return book === 'house' ? 'House rule' : 'In ' + BOOKS[book]; }

  function drawResults() {
    var box = $('rl-results'), idx = $('rl-index'); if (!box) return;
    var q = S.q.trim();
    if (idx) idx.hidden = !!q;
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (!S.corpus) { box.innerHTML = '<p class="rl-note">The rules are not loaded yet.</p>'; return; }
    var r = search(q), n = r.hits.length;
    if (!r.terms.length) { box.innerHTML = '<p class="rl-note">Type a word or two to search.</p>'; return; }
    if (!n) { box.innerHTML = '<p class="rl-note" role="status">Nothing matches \u201c' + esc(q) + '\u201d. Try fewer or shorter words.</p>'; return; }
    var shown = r.hits.slice(0, S.shown);
    box.innerHTML = '<p class="rl-count" role="status">' + plural(n, 'result') + ' for \u201c' + esc(q) + '\u201d</p><ol class="rl-hits">' + shown.map(function (h) { return hitHtml(h, r.terms); }).join('') + '</ol>' +
      (n > shown.length ? '<p><button type="button" class="btn sm" data-rl="more">Show ' + Math.min(PAGE, n - shown.length) + ' more</button></p>' : '');
  }

  /* ---------- page pieces ---------- */
  var CREDIT = '<p>This work is based on <a href="http://www.bladesinthedark.com/" target="_blank" rel="noopener noreferrer">Blades in the Dark</a> (found at <a href="http://www.bladesinthedark.com/" target="_blank" rel="noopener noreferrer">http://www.bladesinthedark.com/</a>), product of One Seven Design, developed and authored by John Harper, and licensed for our use under the Creative Commons Attribution 3.0 Unported license (<a href="http://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">http://creativecommons.org/licenses/by/3.0/</a>).</p>' +
    '<p>Blades \u201968 text is \u00a9 Evil Hat Productions and is here for this table\u2019s private use.</p>';
  function footer() { return '<footer class="rl-credit">' + CREDIT + '</footer>'; }
  function head(kick, title, sub) {
    return '<div class="rl-head"><button type="button" class="btn sm rl-back" data-rl="back">\u2190 Back</button><p class="rl-kick">' + esc(kick) + '</p><h1 class="rl-title" id="rulesTitle" tabindex="-1">' + esc(title) + '</h1>' + (sub ? '<p class="rl-sub">' + sub + '</p>' : '') + '</div>';
  }
  function searchForm(onEntry) {
    return '<form class="rl-search" role="search" data-rl-form="search"><label class="rl-sr" for="rl-q">Search the rules</label>' +
      '<input id="rl-q" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search the rules\u2026" value="' + (onEntry ? '' : esc(S.q)) + '" enterkeyhint="search">' +
      (onEntry ? '' : '<button type="button" class="btn sm" data-rl="clear">Clear</button>') + '</form>';
  }
  function statusLine() {
    var c = S.corpus; if (!c) return '';
    var n = c.entries.length, bits = [plural(n, 'entry', 'entries')];
    if (S.offline) bits.push('offline: the copy saved on this device' + (c.savedAt ? ' (' + when(c.savedAt) + ')' : ''));
    else if (c.fromCache) bits.push('checking for updates\u2026');
    else if (S.error) bits.push('could not check for updates');
    return esc(bits.join(' \u00b7 '));
  }

  /* the index: a section per book, its entries grouped by chapter, built when the section is opened */
  function indexHtml() {
    var c = S.corpus, h = '';
    ORDER.forEach(function (b) {
      var list = c.byBook[b];
      if (!list.length) return;
      h += '<details class="rl-sec" data-book="' + b + '"' + (ORDER.filter(function (x) { return c.byBook[x].length; }).length === 1 ? ' open' : '') + '><summary><b>' + esc(BOOKS[b]) + '</b> <span class="rl-dim">' + plural(list.length, 'entry', 'entries') + '</span></summary><div class="rl-sec-body" data-built="0"></div></details>';
    });
    return h;
  }
  function fillSection(sec) {
    var body = sec.querySelector('.rl-sec-body'); if (!body || body.getAttribute('data-built') === '1' || !S.corpus) return;
    body.setAttribute('data-built', '1');
    var list = S.corpus.byBook[sec.getAttribute('data-book')], groups = [], byName = {};
    list.forEach(function (e) {
      var segs = (e.trail || '').split(' > ').filter(Boolean), name = segs[0] || 'Pages', g = byName[name];
      if (!g) { g = byName[name] = { name: name, items: [] }; groups.push(g); }
      g.items.push({ e: e, depth: Math.min(3, Math.max(0, segs.length - 1)) });
    });
    body.innerHTML = groups.map(function (g) {
      return '<details class="rl-grp"><summary>' + esc(g.name) + ' <span class="rl-dim">' + g.items.length + '</span></summary><ul class="rl-list">' +
        g.items.map(function (x) { return '<li class="d' + x.depth + '"><a href="' + hrefOf(x.e) + '">' + esc(x.e.title) + '</a></li>'; }).join('') + '</ul></details>';
    }).join('');
  }

  /* ---------- the views ---------- */
  function view(name) { return root.getAttribute('data-view') === name; }
  function shell(name, html) { root.setAttribute('data-view', name); root.innerHTML = html; }

  function note(msg, cls) { return '<p class="rl-note' + (cls ? ' ' + cls : '') + '" role="status">' + msg + '</p>'; }

  function unavailableHtml() {
    return head('Rules', 'The rules', '') + note('Rules are available on the hosted app.') +
      '<p class="hint">This view has no rules library: the rulebooks are imported into the hosted app by the GM and read from there.</p>' + footer();
  }

  function drawIndex() {
    var gm = isGM(), c = S.corpus, h;
    if (S.status === 'unavailable') { shell('note', unavailableHtml()); return; }
    if (S.status === 'loading' && !c) { shell('note', head('Rules', 'The rules', '') + note('Opening the rules\u2026') + footer()); return; }
    if (S.status === 'error' && !c) {
      shell('note', head('Rules', 'The rules', '') + note(esc(S.error), 'bad') + '<p><button type="button" class="btn sm" data-rl="retry">Try again</button></p>' + footer());
      return;
    }
    var empty = !c || !c.entries.length;
    h = head('Rules', 'The rules', '<span id="rl-status">' + statusLine() + '</span>') + searchForm();
    h += '<div id="rl-results" class="rl-results" hidden></div>';
    h += '<div id="rl-index" class="rl-indexbox">' + (empty ? note(gm ? 'No rules have been imported yet. Use \u201cImport rules\u201d below to bring in a folder of notes.' : 'The GM has not put the rules in yet.') : indexHtml()) + '</div>';
    if (gm) h += importHtml() + houseHtml();
    var wasOpen = $('rl-import') && $('rl-import').open;
    shell('index', h + footer());
    shownEditor = undefined;
    if (wasOpen && $('rl-import')) $('rl-import').open = true;
    drawResults();
    if (gm) { drawPending(); drawEditor(); }
  }

  /* patch the index view in place after the corpus changes (the search box keeps its focus and the import panel its files) */
  function refreshIndex() {
    if (!view('index') || !S.corpus) { drawIndex(); return; }
    var empty = !S.corpus.entries.length, wasEmpty = !$('rl-index') || $('rl-index').querySelector('.rl-sec') === null;
    if (empty !== wasEmpty) { drawIndex(); return; }
    var st = $('rl-status'); if (st) st.innerHTML = statusLine();
    var idx = $('rl-index');
    if (idx && !empty) {
      var open = {}; idx.querySelectorAll('.rl-sec[open]').forEach(function (d) { open[d.getAttribute('data-book')] = true; });
      idx.innerHTML = indexHtml();
      idx.querySelectorAll('.rl-sec').forEach(function (d) { if (open[d.getAttribute('data-book')]) { d.open = true; fillSection(d); } });
    }
    drawResults();
    var hp = $('rl-houselist'); if (hp) hp.innerHTML = houseList();
  }

  function entryHtml(e) {
    var c = S.corpus, gm = isGM();
    var group = (c.groups[e._n] || [e]).filter(function (x) { return x !== e; }), first = (c.groups[e._n] || [e])[0];
    var body = M.render(e.body, { resolve: resolver(e.book), headingOffset: 1 });
    var segs = (e.trail || '').split(' > ').filter(Boolean);
    var crumbs = '<nav class="rl-crumbs" aria-label="Where this is"><a href="#rules">Rules</a> \u203a <span>' + esc(BOOKS[e.book]) + '</span>' + segs.map(function (s) { return ' \u203a <span>' + esc(s) + '</span>'; }).join('') + '</nav>';
    var list = c.byBook[e.book], at = list.indexOf(e), prev = at > 0 ? list[at - 1] : null, next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
    var h = '<div class="rl-top"><button type="button" class="btn sm rl-back" data-rl="back">\u2190 Back</button>' + searchForm(true) + '</div>' + crumbs +
      '<article class="rl-entry"><p class="rl-kick"><span class="rl-book" data-book="' + e.book + '">' + esc(BOOKS[e.book]) + '</span></p><h1 class="rl-title" id="rulesTitle" tabindex="-1">' + esc(e.title) + '</h1>';
    if (first && first !== e) h += '<p class="rl-alsonote">There is also a ' + esc(BOOKS[first.book]) + ' entry with this title: <a href="' + hrefOf(first) + '">open it</a>.</p>';
    h += '<div class="rl-body">' + (body || '<p class="rl-dim">This entry has no text of its own. Look under it in the index.</p>') + '</div>';
    var sib = (c.bySrc[e.book + '|' + e.src] || []).filter(function (x) { return x !== e; }).slice(0, 40);
    if (sib.length) h += '<nav class="rl-also" aria-label="Also in this note"><span class="rl-lab">Also in this note</span><ul class="rl-list">' + sib.map(function (x) { return '<li><a href="' + hrefOf(x) + '">' + esc(x.title) + '</a></li>'; }).join('') + '</ul></nav>';
    group.forEach(function (t) {
      h += '<details class="rl-twin rl-twin-full"><summary>' + esc(twinLabel(t.book)) + '</summary><div class="rl-body">' + M.render(t.body, { resolve: resolver(t.book), headingOffset: 2 }) + '</div><p><a href="' + hrefOf(t) + '">Open this entry on its own</a></p></details>';
    });
    if (gm && e.book === 'house') h += '<p class="rl-gmtools"><button type="button" class="btn sm" data-rl="edit" data-slug="' + esc(e.slug) + '">Edit this house rule</button> <button type="button" class="btn sm" data-rl="delhouse" data-slug="' + esc(e.slug) + '">Delete</button></p>';
    h += '</article><nav class="rl-pager" aria-label="Neighbouring entries">' + (prev ? '<a class="rl-prev" href="' + hrefOf(prev) + '">\u2190 ' + esc(prev.title) + '</a>' : '<span></span>') + (next ? '<a class="rl-next" href="' + hrefOf(next) + '">' + esc(next.title) + ' \u2192</a>' : '<span></span>') + '</nav>';
    return h + footer();
  }

  function drawEntry(book, slug) {
    if (S.status === 'unavailable') { shell('note', unavailableHtml()); return; }
    var c = S.corpus;
    if (!c) { drawIndex(); return; }
    var e = c.byId[book + '/' + slug];
    if (!e) {
      shell('note', head('Rules', 'Not found', '') + note('There is no entry \u201c' + esc(book + '/' + slug) + '\u201d. It may have been renamed when the book was imported again.') +
        '<p><a class="btn sm" href="#rules?q=' + encodeURIComponent(slug.replace(/[-_]+/g, ' ')) + '">Search for it</a> <a class="btn sm" href="#rules">The index</a></p>' + footer());
      focusTitle(); return;
    }
    shell('entry', entryHtml(e));
    try { document.title = e.title + ' \u00b7 Rules \u00b7 ' + SUFFIX; } catch (x) {}
    window.scrollTo(0, 0);
    focusTitle();
  }
  function focusTitle() { var t = $('rulesTitle'); if (t) { try { t.focus({ preventScroll: true }); } catch (e) {} } }

  function parseHash() {
    var h = location.hash || '', m = /^#rules(?:\/([^\/?]+)\/([^?]+))?(?:\?(.*))?$/.exec(h), out = { book: '', slug: '', params: {} };
    if (!m) return out;
    function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
    out.book = m[1] ? dec(m[1]) : ''; out.slug = m[2] ? dec(m[2]) : '';
    (m[3] || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); out.params[dec((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '))] = i < 0 ? '' : dec(kv.slice(i + 1).replace(/\+/g, ' ')); });
    return out;
  }

  var editing;   /* undefined: no editor; '': a new house rule; 'slug': that one */
  function draw() {
    if (!active || !root) return;
    var p = parseHash();
    if (p.book && p.slug) { drawEntry(p.book, p.slug); return; }
    S.q = p.params.q || '';
    editing = 'edit' in p.params ? p.params.edit : undefined;
    if (view('index') && S.corpus && S.status === 'ready') {
      /* already drawn: just bring it up to date */
      var q = $('rl-q'); if (q && q.value !== S.q) q.value = S.q;
      refreshIndex(); drawEditor();
    } else {
      drawIndex();
    }
    try { document.title = 'Rules \u00b7 ' + SUFFIX; } catch (e) {}
  }

  /* ---------- the GM's importer ---------- */
  function importHtml() {
    return '<details class="rl-box rl-import" id="rl-import"><summary>Import rules <span class="rl-dim">GM only</span></summary><div class="rl-box-body">' +
      '<p class="hint">Do this on the PC that holds the rulebook notes, in Chrome or Edge. Pick the book, then the folder of markdown files (Obsidian notes are fine). Each file is split at its headings into entries, shown to you before anything is sent. Importing a book again replaces it.</p>' +
      '<div class="rl-field"><span class="rl-lab" id="rl-booklab">Book</span><span class="seg" role="group" aria-labelledby="rl-booklab"><button type="button" class="chip" data-rl="book" data-book="b68" aria-pressed="true">' + esc(BOOKS.b68) + '</button><button type="button" class="chip" data-rl="book" data-book="bitd" aria-pressed="false">' + esc(BOOKS.bitd) + '</button></span></div>' +
      '<div class="rl-field"><label class="rl-lab" for="rl-folder">Folder of markdown files</label><input type="file" id="rl-folder" webkitdirectory directory multiple></div>' +
      '<div id="rl-preview" class="rl-preview" aria-live="polite"></div>' +
      '<p><button type="button" class="btn primary" data-rl="import" id="rl-go" disabled>Import</button></p>' +
      '<p id="rl-progress" class="rl-progress" role="status"></p></div></details>';
  }

  var PEND = { book: 'b68', plan: null, reading: false };
  function drawPending() {
    var box = $('rl-preview'), go = $('rl-go'); if (!box) return;
    document.querySelectorAll('#rl-import [data-rl="book"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-book') === PEND.book)); });
    var p = PEND.plan, existing = S.corpus ? S.corpus.byBook[PEND.book].length : 0;
    if (!p) { box.innerHTML = ''; if (go) { go.disabled = true; go.textContent = 'Import'; } return; }
    var bad = p.entries.length > LIMITS.bookEntries ? 'This makes ' + p.entries.length + ' entries; a book can hold ' + LIMITS.bookEntries + '.' : p.bytes > LIMITS.bookBytes ? 'This is ' + Math.round(p.bytes / 1024) + ' KB of text; a book can hold ' + Math.round(LIMITS.bookBytes / 1024) + ' KB.' : !p.entries.length ? 'No markdown files with text were found in that folder.' : '';
    box.innerHTML = '<ul class="rl-pv"><li><b>' + plural(p.files, 'file') + '</b> read' + (p.skipped ? ' (' + plural(p.skipped, 'other file') + ' ignored: not markdown, or inside a hidden folder such as .obsidian)' : '') + '</li>' +
      '<li><b>' + plural(p.entries.length, 'entry', 'entries') + '</b>, ' + Math.round(p.bytes / 1024) + ' KB of text, sent in ' + plural(p.chunks.length, 'part') + '</li>' +
      (p.parts ? '<li>' + plural(p.parts, 'long section') + ' cut into parts to fit</li>' : '') +
      '<li>' + esc(BOOKS[PEND.book]) + (existing ? ' has ' + plural(existing, 'entry', 'entries') + ' now: <b>importing replaces them</b>' : ' has nothing yet') + '</li></ul>' +
      (p.entries.length ? '<p class="rl-dim">First entries: ' + p.entries.slice(0, 4).map(function (e) { return esc(e.title); }).join(' \u00b7 ') + (p.entries.length > 4 ? ' \u00b7 \u2026' : '') + '</p>' : '') +
      (bad ? '<p class="rl-note bad">' + esc(bad) + '</p>' : '');
    if (go) { go.disabled = !!bad || S.busy; go.textContent = 'Import ' + plural(p.entries.length, 'entry', 'entries') + (existing ? ' and replace ' + esc(BOOKS[PEND.book]) : ''); }
  }
  function say(msg, bad) { var p = $('rl-progress'); if (p) { p.textContent = msg; p.className = 'rl-progress' + (bad ? ' bad' : ''); } }

  function readText(f) {
    if (f.text) return f.text();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { rej(r.error); }; r.readAsText(f); });
  }

  /* the picked files -> entries with unique slugs and order; { files, skipped, entries, bytes, parts, chunks } */
  function plan(files) {
    var picked = [], skipped = 0;
    Array.prototype.forEach.call(files, function (f) {
      var rel = String(f.webkitRelativePath || f.name).replace(/\\/g, '/'), segs = rel.split('/');
      if (segs.length > 1) segs.shift();                       /* the folder that was picked */
      var hidden = segs.some(function (s) { return s.charAt(0) === '.'; });
      if (hidden || !/\.md$/i.test(f.name)) { skipped++; return; }
      picked.push({ file: f, path: segs.join('/') });
    });
    picked.sort(function (a, b) { return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }); });
    return { picked: picked, skipped: skipped };
  }
  function buildPlan(picked, skipped) {
    var used = {}, entries = [], parts = 0, ord = 0;
    function uniq(e) {
      var base = slugify(e.title), last = (e.trail || '').split(' > ').filter(Boolean).pop(), n = 1, s = base;
      if (used[s] && last) s = slugify(last + ' ' + e.title);
      while (used[s]) { n++; s = base.slice(0, 74) + '-' + n; }
      used[s] = 1; return s;
    }
    picked.forEach(function (p) {
      p.sections.forEach(function (s) {
        if (/ \(part \d+\)$/.test(s.title)) parts++;
        entries.push({ slug: uniq(s), title: s.title.slice(0, 200), trail: s.trail.slice(0, 600), keys: (s.keys || '').slice(0, 600), body: s.body, ord: ord++, src: p.path.slice(0, 600) });
      });
    });
    /* chunks of about 300 KB of JSON and at most 100 entries, in order */
    var chunks = [], cur = [], size = 0, bytes = 0;
    entries.forEach(function (e) {
      var n = utf8len(JSON.stringify(e)); bytes += utf8len(e.body);
      if (cur.length && (size + n > LIMITS.chunkBytes || cur.length >= LIMITS.chunkEntries)) { chunks.push(cur); cur = []; size = 0; }
      cur.push(e); size += n;
    });
    if (cur.length) chunks.push(cur);
    return { files: picked.length, skipped: skipped, entries: entries, bytes: bytes, parts: parts, chunks: chunks };
  }

  function pickFolder(input) {
    var files = input.files; PEND.plan = null;
    if (!files || !files.length) { drawPending(); say(''); return; }
    var pl = plan(files), picked = pl.picked, i = 0;
    PEND.reading = true; say('Reading ' + plural(picked.length, 'file') + '\u2026');
    (function next() {
      if (i >= picked.length) {
        PEND.reading = false; say('');
        PEND.plan = buildPlan(picked, pl.skipped); drawPending(); return;
      }
      var p = picked[i++];
      readText(p.file).then(function (text) { p.sections = M.splitFile(p.path, text); }, function () { p.sections = []; }).then(function () {
        if (i % 25 === 0) say('Reading ' + i + ' of ' + picked.length + ' files\u2026');
        if (i % 25 === 0) setTimeout(next, 0); else next();
      });
    })();
  }

  function doImport() {
    var p = PEND.plan, rt = runtime(); if (!p || !rt || S.busy || !p.entries.length) return;
    var book = PEND.book, existing = S.corpus ? S.corpus.byBook[book].length : 0;
    if (existing && !window.confirm('Replace the ' + plural(existing, 'entry', 'entries') + ' now in ' + BOOKS[book] + ' with these ' + plural(p.entries.length, 'entry', 'entries') + '?')) return;
    S.busy = true; drawPending();
    var of = p.chunks.length, done = 0, sent = 0;
    function one(k, attempt) {
      say('Uploading part ' + (k + 1) + ' of ' + of + ' (' + sent + ' of ' + p.entries.length + ' entries sent)\u2026');
      return rt.import({ book: book, entries: p.chunks[k], replace: true, part: k + 1, of: of }).catch(function (e) {
        if (attempt < 2 && (!e.status || e.status >= 500 || e.network)) return new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); }).then(function () { return one(k, attempt + 1); });
        throw e;
      });
    }
    (function step(k) {
      if (k >= of) {
        say('Imported ' + plural(p.entries.length, 'entry', 'entries') + ' into ' + BOOKS[book] + '. Loading them\u2026');
        return load2();
      }
      return one(k, 0).then(function () { sent += p.chunks[k].length; done++; return step(k + 1); });
    })(0).catch(function (e) {
      S.busy = false; drawPending();
      say('The import stopped at part ' + (done + 1) + ' of ' + of + ': ' + (e && e.message || e) + (done ? ' ' + BOOKS[book] + ' now holds only the first ' + plural(sent, 'entry', 'entries') + '; run the import again to replace it.' : ''), true);
      if (done) load(true);
    });
    function load2() {
      return fetchRules().then(function () {
        S.busy = false; PEND.plan = null; var inp = $('rl-folder'); if (inp) inp.value = '';
        S.status = 'ready'; refreshIndex(); drawPending();
        say('Imported ' + plural(p.entries.length, 'entry', 'entries') + ' into ' + BOOKS[book] + '.');
      });
    }
  }

  /* ---------- house rules (GM) ---------- */
  function houseList() {
    var list = S.corpus ? S.corpus.byBook.house : [];
    return list.length ? '<ul class="rl-list">' + list.map(function (e) { return '<li><a href="' + hrefOf(e) + '">' + esc(e.title) + '</a> <button type="button" class="hm-link rl-linkbtn" data-rl="edit" data-slug="' + esc(e.slug) + '">Edit</button></li>'; }).join('') + '</ul>' : '<p class="rl-dim">None yet.</p>';
  }
  function houseHtml() {
    return '<section class="rl-box rl-house" id="rl-house" aria-labelledby="rl-house-h"><h2 id="rl-house-h" class="rl-boxh">House rules <span class="rl-dim">GM only</span></h2><div class="rl-box-body"><div id="rl-houselist">' + houseList() + '</div>' +
      '<p><button type="button" class="btn sm" data-rl="edit" data-slug="">New house rule</button></p><div id="rl-editor"></div></div></section>';
  }
  var shownEditor;   /* which editor is drawn, so a refresh of the page does not wipe what is being typed */
  function drawEditor() {
    var box = $('rl-editor'); if (!box) return;
    if (editing === undefined) { box.innerHTML = ''; shownEditor = undefined; return; }
    if (shownEditor === editing && box.firstChild) return;
    shownEditor = editing;
    var cur = editing && S.corpus ? S.corpus.byId['house/' + editing] : null;
    if (editing && !cur) { box.innerHTML = note('That house rule is gone.', 'bad'); return; }
    box.innerHTML = '<form class="rl-edit" data-rl-form="house" novalidate><h3>' + (cur ? 'Edit \u201c' + esc(cur.title) + '\u201d' : 'New house rule') + '</h3>' +
      '<div class="rl-field"><label class="rl-lab" for="rl-h-title">Title</label><input id="rl-h-title" type="text" maxlength="200" value="' + esc(cur ? cur.title : '') + '" autocomplete="off"></div>' +
      '<div class="rl-field"><label class="rl-lab" for="rl-h-body">Rule (Markdown)</label><textarea id="rl-h-body" rows="9" spellcheck="true">' + esc(cur ? cur.body : '') + '</textarea></div>' +
      '<details class="rl-twin"><summary>Preview</summary><div class="rl-body" id="rl-h-prev"></div></details>' +
      '<p class="rl-acts"><button type="submit" class="btn primary">Save</button> <button type="button" class="btn" data-rl="canceledit">Cancel</button>' + (cur ? ' <button type="button" class="btn" data-rl="delhouse" data-slug="' + esc(cur.slug) + '">Delete</button>' : '') + '</p><p id="rl-h-msg" class="rl-progress" role="status"></p></form>';
    try { $('rl-h-title').scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  function houseMsg(msg, bad) { var m = $('rl-h-msg'); if (m) { m.textContent = msg; m.className = 'rl-progress' + (bad ? ' bad' : ''); } }
  function saveHouse() {
    var rt = runtime(), title = ($('rl-h-title').value || '').trim(), body = $('rl-h-body').value;
    if (!title) { houseMsg('Give the rule a title.', true); $('rl-h-title').focus(); return; }
    var slug = editing || slugify(title);
    if (!editing && S.corpus && S.corpus.byId['house/' + slug]) { houseMsg('A house rule with that name already exists: edit it instead.', true); return; }
    houseMsg('Saving\u2026');
    rt.saveHouse(slug, { title: title, body: body, trail: 'House rules' }).then(function () { return fetchRules(); }).then(function () {
      editing = undefined; location.hash = '#rules/house/' + slug;
    }, function (e) { houseMsg('Could not save: ' + (e && e.message || e), true); });
  }
  function deleteHouse(slug) {
    var rt = runtime(), e = S.corpus && S.corpus.byId['house/' + slug];
    if (!rt || !window.confirm('Delete the house rule \u201c' + (e ? e.title : slug) + '\u201d? Everyone at the table loses it.')) return;
    rt.deleteHouse(slug).then(function () { return fetchRules(); }).then(function () { editing = undefined; location.hash = '#rules'; draw(); }, function (err) { houseMsg('Could not delete: ' + (err && err.message || err), true); });
  }

  /* ---------- events ---------- */
  var hashT = null;
  function syncHash() {
    hashT = null;
    if (!active || !view('index')) return;                       /* a search typed just before opening an entry must not rewrite the entry's address */
    var q = S.q.trim(), h = q ? '#rules?q=' + encodeURIComponent(q) : '#rules';
    if (location.hash === h) return;
    try { history.replaceState(history.state, '', h); } catch (e) {}
  }
  function onInput(ev) {
    var t = ev.target;
    if (t.id === 'rl-q') {
      S.q = t.value; S.shown = PAGE;
      if (view('entry')) return;                                  /* the box on an entry page only searches when submitted */
      drawResults();
      if (hashT) clearTimeout(hashT);
      hashT = setTimeout(syncHash, 250);
    } else if (t.id === 'rl-h-body') {
      var pv = $('rl-h-prev'); if (pv) pv.innerHTML = M.render(t.value, { resolve: resolver('house'), headingOffset: 2 });
    }
  }
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-rl]'); if (!b || !root.contains(b)) return;
    var a = b.getAttribute('data-rl');
    if (a === 'back') { if (api && api.back) api.back(); }
    else if (a === 'clear') { S.q = ''; var q = $('rl-q'); if (q) { q.value = ''; q.focus(); } if (view('index')) { drawResults(); syncHash(); } else location.hash = '#rules'; }
    else if (a === 'more') { S.shown += PAGE; drawResults(); }
    else if (a === 'retry') load(true);
    else if (a === 'book') { PEND.book = b.getAttribute('data-book'); PEND.plan = null; var inp = $('rl-folder'); if (inp) inp.value = ''; say(''); drawPending(); }
    else if (a === 'import') doImport();
    else if (a === 'edit') {
      var slug = b.getAttribute('data-slug') || '', want = '#rules?edit=' + encodeURIComponent(slug);
      if (location.hash === want) { editing = slug; drawEditor(); } else location.hash = want;
    }
    else if (a === 'canceledit') { editing = undefined; location.hash = '#rules'; }
    else if (a === 'delhouse') deleteHouse(b.getAttribute('data-slug'));
  }
  function onChange(ev) { if (ev.target.id === 'rl-folder') pickFolder(ev.target); }
  function onSubmit(ev) {
    var f = ev.target.getAttribute && ev.target.getAttribute('data-rl-form'); if (!f) return;
    ev.preventDefault();
    if (f === 'search') {
      var q = $('rl-q').value.trim();
      if (view('entry')) { S.q = q; location.hash = q ? '#rules?q=' + encodeURIComponent(q) : '#rules'; return; }
      var first = root.querySelector('.rl-hit-title'); if (first) first.focus();
    } else if (f === 'house') saveHouse();
  }
  function onKey(ev) {
    var t = ev.target, hits;
    if (t.id === 'rl-q') {
      if (ev.key === 'Escape') { if (t.value) { ev.preventDefault(); t.value = ''; S.q = ''; if (view('index')) { drawResults(); syncHash(); } } }
      else if (ev.key === 'ArrowDown') { hits = root.querySelectorAll('.rl-hit-title'); if (hits.length) { ev.preventDefault(); hits[0].focus(); } }
      return;
    }
    if (t.classList && t.classList.contains('rl-hit-title') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      hits = Array.prototype.slice.call(root.querySelectorAll('.rl-hit-title'));
      var i = hits.indexOf(t), n = ev.key === 'ArrowDown' ? i + 1 : i - 1;
      ev.preventDefault();
      if (n < 0) { var q = $('rl-q'); if (q) q.focus(); } else if (n < hits.length) hits[n].focus();
    }
  }
  function onToggle(ev) {
    var d = ev.target;
    if (d && d.classList && d.classList.contains('rl-sec') && d.open) fillSection(d);
  }
  /* "/" jumps to the search box, as on most wikis */
  function onDoc(ev) {
    if (!active || ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var t = ev.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    var q = $('rl-q'); if (q) { ev.preventDefault(); q.focus(); q.select(); }
  }

  /* ---------- the module ---------- */
  function open(el, a) {
    if (root !== el) {
      root = el;
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      root.addEventListener('submit', onSubmit);
      root.addEventListener('keydown', onKey);
      root.addEventListener('toggle', onToggle, true);
      document.addEventListener('keydown', onDoc);
    }
    api = a; active = true;
    root.removeAttribute('data-view');
    S.q = parseHash().params.q || '';
    S.shown = PAGE;
    var ready = api && api.ready ? api.ready() : Promise.resolve();
    S.status = !runtime() ? 'unavailable' : S.corpus ? 'ready' : 'loading';
    draw();
    ready.then(function () { if (active) { draw(); load(false); } });
  }
  function route() { if (active && root) { draw(); if (S.corpus && Date.now() - S.checkedAt > 60000) load(false); } }
  function close() { active = false; S.token++; if (hashT) { clearTimeout(hashT); hashT = null; } }

  window.B68Rules = { available: available, help: help, open: open, route: route, close: close, KEYWORDS: KEYWORDS, _search: function (q) { var r = search(q); return r.hits.map(function (h) { return h.primary.book + '/' + h.primary.slug; }); } };
})();
