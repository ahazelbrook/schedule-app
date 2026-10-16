/* gm/prep.js — the GM page's Prep tab (GM.md, "Prep"): the GM's prep notes as written in the vault, laid out in the app.
   The notes arrive in the GM pack (part `prep`, built by scripts/lib/prep-export.mjs): each note is a list of Markdown
   blocks, a transcluded section of another note being a block of its own. Nothing here parses a note into a model. The
   blocks are cut at their ## headings into sections (the section rail and the pins) and rendered with B68Markdown, the
   same renderer the exporter ran, so the task boxes come out in the order the exporter matched them to their lines.
   Then `decorate` adds what recognisers find, each optional, each leaving the plain render when it finds nothing:
     task boxes        tickable (the tick is GM state; `npm run gm:pull` ticks the box in its note, SYNC.md)
     a ✓ / ☐ column    its cells tickable (filed as a line under "## At the table (app)")
     a run-order table a "#" column plus an About / Time column: a start button per row and the time against the budget
     > [!quote] SAY    read-aloud card; `[like this]` code spans: provenance chips
   Plain script, UMD: window.B68GmPrep in the browser, module.exports under Node. Pack text reaches the page only through
   B68Markdown.render (which escapes all HTML) or esc().

   API
     notes(part)                          [{ id, title, session, date, status }]
     view(part, noteId, o)                { html, rail: [{ id, text }], secs: { id: { src, block, at } }, note }
         o = { M: B68Markdown, exportedAt }
     section(part, noteId, secId, o)      the html of one section (for a pin in the rail), or ''
     link(href)                           { type: 'heading', id } | { type: 'top' } | { type: 'page', kind, key, frag } | null
     obsidianUri(part, rel)               obsidian://open?vault=…&file=…
     scores(part)                         [{ key, label, site, rel }] every embedded score card once (the exporter's `score`),
                                          in the notes' order; view() gives each its slot, <div class="pp-site" data-score>, which
                                          the GM page fills with the site strip (GM.md, "Score sites")
     decorate(el, o)                      DOM: boxes, cells, beats, chips, SAY. o = { ticks, cells, beats, now }
     budget(text)                         minutes in "10 min", "35–40 min" (the upper end), or null
     hash(text)                           a short stable key (FNV-1a, hex) */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmPrep = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x'; }
  function norm(s) { return str(s).replace(/\s+/g, ' ').trim().slice(0, 200); }
  function hash(s) { var h = 0x811c9dc5; s = str(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }

  function notesOf(part) { return isObj(part) && Array.isArray(part.notes) ? part.notes.filter(isObj) : []; }
  function notes(part) { return notesOf(part).map(function (n) { return { id: str(n.id), title: str(n.title), session: str(n.session), date: str(n.date), status: str(n.status) }; }); }
  function noteOf(part, id) { var l = notesOf(part); return l.filter(function (n) { return n.id === id; })[0] || l[0] || null; }

  function obsidianUri(part, rel) {
    if (!isObj(part) || !part.vault || !rel) return '';
    return 'obsidian://open?vault=' + encodeURIComponent(str(part.vault)) + '&file=' + encodeURIComponent(str(rel).replace(/\.md$/i, ''));
  }
  function fileName(rel) { return str(rel).split('/').pop().replace(/\.md$/i, ''); }

  /* a block's Markdown cut at its ## lines (outside fenced code): [{ head, src }] (the first may have no heading) */
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  function cut(src) {
    var out = [{ head: null, lines: [] }], fence = null;
    str(src).split('\n').forEach(function (ln) {
      var m = FENCE.exec(ln);
      if (fence) { if (m && m[1].charAt(0) === fence.charAt(0) && m[1].length >= fence.length) fence = null; }
      else if (m) fence = m[1];
      else if (/^ {0,3}## +\S/.test(ln)) out.push({ head: ln.replace(/^ {0,3}## +/, '').replace(/[ \t]+#+[ \t]*$/, '').trim(), lines: [] });
      out[out.length - 1].lines.push(ln);
    });
    return out.filter(function (s) { return s.head !== null || s.lines.join('').trim(); }).map(function (s) { return { head: s.head, src: s.lines.join('\n') }; });
  }

  /* the wikilink resolvers: a page the pack knows becomes a #pp: link the page handles; anything else stays text */
  function resolvers(part) {
    var links = isObj(part) && isObj(part.links) ? part.links : {};
    return {
      resolve: function (page, frag) {
        var key = str(page).toLowerCase().replace(/\.md$/i, ''), L = links[key];
        if (!isObj(L)) return null;
        return { href: '#pp:' + slug(L.k) + ':' + encodeURIComponent(key) + (frag ? ':' + encodeURIComponent(frag) : '') };
      },
      resolveLocal: function (frag) { return { href: frag && frag.charAt(0) === '^' ? '#pp:top' : '#pp:h:' + encodeURIComponent(str(frag)) }; }
    };
  }

  /* one piece of Markdown with its task boxes: tasks[k...] are matched in order and checked against their text */
  function renderPiece(M, src, tasks, state, o, idPrefix) {
    var r = resolvers(o.part), used = {};
    return M.render('\n' + src, {
      resolve: r.resolve, resolveLocal: r.resolveLocal, headingOffset: 1,
      headingId: function (text) { var id = idPrefix + slug(text); while (used[id]) id += '-'; used[id] = 1; return id; },
      task: function (t) { var e = tasks[state.k++]; return e && e.a && norm(t.text) === norm(e.t) ? e.a : null; }
    });
  }

  function view(part, noteId, o) {
    o = o || {}; var M = o.M, n = noteOf(part, noteId);
    if (!n || !M || !M.render) return { html: '', rail: [], secs: {}, note: null };
    var ro = { part: part }, rail = [], secs = {}, html = '', used = {};
    (n.blocks || []).forEach(function (b, bi) {
      if (!isObj(b)) return;
      var tasks = Array.isArray(b.tasks) ? b.tasks : [], st = { k: 0 };
      if (b.k === 'embed') {
        var sk = scoreOf(b) ? esc(b.score.key) : '';
        html += '<section class="pp-embed" data-from="' + esc(b.from) + '"' + (sk ? ' data-score="' + sk + '"' : '') + '><header class="pp-embed-h"><span class="pp-from">From <b>' + esc(fileName(b.from)) + '</b></span>' +
          '<a class="btn sm" href="' + esc(obsidianUri(part, b.from)) + '">Open in Obsidian</a></header>' + (sk ? '<div class="pp-site" data-score="' + sk + '"></div>' : '') + renderPiece(M, str(b.src), tasks, st, ro, 'pe' + bi + '--') + '</section>';
        return;
      }
      /* the note's own # title repeats the header above it: drop that one line (it holds no task box) */
      var src = str(b.src);
      if (bi === 0 || !html) src = src.replace(/^([\s\S]*?)^# +(.+?)[ \t]*$\n?/m, function (m, pre, t) { return !pre.trim() && t.trim() === str(n.title).trim() ? '' : m; });
      cut(src).forEach(function (s) {
        var at = st.k, id = s.head ? 'pp-' + slug(s.head) : 'pp-b' + bi;
        while (used[id]) id += '-'; used[id] = 1;
        var body = renderPiece(M, s.src, tasks, st, ro, id + '--');
        if (s.head) rail.push({ id: id, text: s.head });
        secs[id] = { src: s.src, block: bi, at: at, head: s.head || '' };
        html += '<section class="pp-sec" id="' + id + '" data-sec="' + id + '">' +
          (s.head ? '<div class="pp-sec-acts"><button type="button" class="pp-pin" data-gm="prep-pin" data-sec="' + id + '" aria-pressed="false" title="Keep this section in the rail">Pin</button></div>' : '') + body + '</section>';
      });
    });
    var meta = [n.session ? 'Session ' + n.session : '', n.date, n.status].filter(Boolean).join(' · ');
    var head = '<header class="pp-head"><p class="gm-kick">Prep' + (o.exportedAt ? ' · exported ' + esc(o.exportedAt) : '') + '</p><h2 class="pp-title">' + esc(n.title) + '</h2>' +
      (meta ? '<p class="pp-meta">' + esc(meta) + '</p>' : '') + '<p class="pp-acts"><a class="btn sm" href="' + esc(obsidianUri(part, n.rel)) + '">Open in Obsidian</a></p></header>';
    return { html: head + html, rail: rail, secs: secs, note: n };
  }

  /* a block that is an embedded score card (the exporter's `score`, its key a plain file name) */
  var KEY_RE = /^[^\u0000-\u001f"<>\\]{1,120}$/;
  function scoreOf(b) { return isObj(b) && b.k === 'embed' && isObj(b.score) && KEY_RE.test(str(b.score.key)) ? b.score : null; }
  function scores(part) {
    var out = [], seen = {};
    notesOf(part).forEach(function (n) {
      (Array.isArray(n.blocks) ? n.blocks : []).forEach(function (b) {
        var s = scoreOf(b); if (!s || seen[s.key]) return;
        seen[s.key] = 1;
        var site = {};
        if (isObj(s.site)) ['target', 'district', 'approach', 'faction'].forEach(function (k) { if (str(s.site[k]).trim()) site[k] = str(s.site[k]).trim(); });
        out.push({ key: str(s.key), label: str(s.label).trim() || str(s.key), site: site, rel: str(b.from) });
      });
    });
    return out;
  }

  /* one section again, with its own boxes (a pin in the rail) */
  function section(part, noteId, secId, o) {
    o = o || {}; var v = o.view || view(part, noteId, o), s = v.secs[secId], n = v.note;
    if (!s || !n) return '';
    var b = n.blocks[s.block], st = { k: s.at };
    return renderPiece(o.M, s.src, b.tasks || [], st, { part: part }, 'pin-' + secId + '--');
  }

  function link(href) {
    var h = str(href);
    if (h.indexOf('#pp:') !== 0) return null;
    var p = h.slice(4).split(':');
    try {
      if (p[0] === 'top') return { type: 'top' };
      if (p[0] === 'h') return { type: 'heading', text: decodeURIComponent(p.slice(1).join(':')) };
      return { type: 'page', kind: p[0], key: decodeURIComponent(p[1] || ''), frag: p.length > 2 ? decodeURIComponent(p.slice(2).join(':')) : '' };
    } catch (e) { return null; }
  }

  function budget(text) {
    var m = /(\d+)(?:\s*[–—-]\s*(\d+))?\s*(?:min|mins|minutes|m)\b/i.exec(str(text));
    if (m) return +(m[2] || m[1]);
    m = /(\d+)(?:\s*[–—-]\s*(\d+))?\s*(?:h|hr|hrs|hours?)\b/i.exec(str(text));
    return m ? 60 * +(m[2] || m[1]) : null;
  }
  function mmss(ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return m + ':' + ('0' + (s % 60)).slice(-2); }
  function hhmm(iso) { var d = new Date(iso); if (isNaN(d)) return ''; return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function text(el) { return el ? str(el.textContent).replace(/\s+/g, ' ').trim() : ''; }

  /* ---------- DOM: what the recognisers add after a render ---------- */
  function decorate(el, o) {
    if (!el || !el.querySelectorAll) return;
    o = o || {};
    var ticks = isObj(o.ticks) ? o.ticks : {}, cells = isObj(o.cells) ? o.cells : {}, beats = isObj(o.beats) ? o.beats : {}, now = o.now || Date.now();
    /* task boxes: ticked in the note (locked), ticked here, or open */
    [].forEach.call(el.querySelectorAll('.rl-task[data-task]'), function (b) {
      if (!b.hasAttribute('data-init')) { b.setAttribute('data-init', '1'); if (b.classList.contains('done')) b.setAttribute('data-done', '1'); }   /* as the note has it */
      var a = b.getAttribute('data-task'), inNote = b.getAttribute('data-done') === '1', here = !!ticks[a];
      b.setAttribute('role', 'checkbox'); b.removeAttribute('aria-hidden'); b.tabIndex = inNote ? -1 : 0;
      b.setAttribute('aria-checked', String(inNote || here)); b.setAttribute('aria-disabled', String(inNote));
      b.classList.toggle('pp-box', true); b.classList.toggle('done', inNote || here); b.classList.toggle('here', here && !inNote);
      b.textContent = inNote || here ? '☑' : '☐';
      b.title = inNote ? 'Ticked in the note' : here ? 'Ticked here: the sync ticks it in the note' : 'Tick';
      var li = b.parentNode; if (li && li.classList) li.classList.toggle('pp-done', inNote || here);
    });
    /* provenance: a code span that is all one [bracket] */
    [].forEach.call(el.querySelectorAll('code'), function (c) { if (/^\[[^\[\]]{2,80}\]$/.test(text(c))) c.classList.add('pp-prov'); });
    /* SAY: a quote callout titled Say */
    [].forEach.call(el.querySelectorAll('.rl-callout'), function (c) {
      var t = c.querySelector('.rl-callout-title');
      if (c.getAttribute('data-callout') === 'quote' && /^say\b/i.test(text(t))) c.classList.add('pp-say');
    });
    /* tables: a tick column, a run order */
    [].forEach.call(el.querySelectorAll('table'), function (tb, ti) {
      var heads = [].map.call(tb.querySelectorAll('thead th'), text), secEl = tb.closest ? tb.closest('[data-sec]') : null, sec = secEl ? secEl.getAttribute('data-sec') : 'x';
      var tickCol = heads.findIndex(function (h) { return /^[✓✔☐☑✅]$/.test(h); });
      var timeCol = heads.findIndex(function (h) { return /^(about|time|budget|length)$/i.test(h); });
      var runOrder = timeCol > 0 && heads[0] === '#';
      [].forEach.call(tb.querySelectorAll('tbody tr'), function (tr) {
        var tds = tr.querySelectorAll('td'); if (!tds.length) return;
        if (!tr.hasAttribute('data-rk')) { tr.setAttribute('data-rk', text(tds[0]) + '|' + text(tds[1])); tr.setAttribute('data-rl', (text(tds[0]) + ' ' + text(tds[1])).slice(0, 200)); if (timeCol >= 0 && tds[timeCol]) tr.setAttribute('data-min', str(budget(text(tds[timeCol])) || '')); }
        var rowKey = tr.getAttribute('data-rk');
        if (tickCol >= 0 && tds[tickCol]) {
          var ck = 'c' + hash(sec + '|' + ti + '|' + rowKey), on = !!cells[ck], td = tds[tickCol];
          td.className = 'pp-cell' + (on ? ' done' : ''); td.setAttribute('data-cell', ck); td.setAttribute('data-label', tr.getAttribute('data-rl'));
          td.setAttribute('role', 'checkbox'); td.setAttribute('aria-checked', String(on)); td.tabIndex = 0; td.textContent = on ? '☑' : '☐';
        }
        if (runOrder && /\S/.test(text(tds[0])) && tds[timeCol]) {
          var bk = 'b' + hash(sec + '|' + ti + '|' + rowKey), started = isObj(beats[bk]) ? beats[bk].at : null, min = +tr.getAttribute('data-min') || null;
          var cell = tds[0], btn = cell.querySelector('.pp-beat'), doc = el.ownerDocument;
          if (!btn) { btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'pp-beat'; btn.setAttribute('data-gm', 'prep-beat'); cell.insertBefore(btn, cell.firstChild); }
          btn.setAttribute('data-beat', bk); btn.setAttribute('data-label', tr.getAttribute('data-rl'));
          btn.setAttribute('aria-pressed', String(!!started));
          var latest = started && Object.keys(beats).every(function (k) { return !isObj(beats[k]) || str(beats[k].at) <= started; });
          var el2 = tds[timeCol].querySelector('.pp-clock'); if (!el2) { el2 = doc.createElement('span'); el2.className = 'pp-clock'; tds[timeCol].appendChild(el2); }
          if (started && latest) {
            var ms = now - Date.parse(started), over = min ? ms / 60000 / min : 0;
            el2.textContent = mmss(ms) + (min ? ' / ' + min + ':00' : ''); el2.className = 'pp-clock run' + (over >= 1.5 ? ' late' : over >= 1 ? ' due' : '');
            btn.textContent = '■'; btn.title = 'Running since ' + hhmm(started) + '. Tap to clear';
          } else if (started) { el2.textContent = 'from ' + hhmm(started); el2.className = 'pp-clock'; btn.textContent = '✓'; btn.title = 'Started ' + hhmm(started) + '. Tap to clear'; }
          else { el2.textContent = ''; el2.className = 'pp-clock'; btn.textContent = '▶'; btn.title = 'Start this beat'; }
          tr.classList.toggle('pp-running', !!(started && latest));
        }
      });
    });
  }

  return { notes: notes, view: view, section: section, link: link, obsidianUri: obsidianUri, decorate: decorate, budget: budget, hash: hash, cut: cut, slug: slug, norm: norm, scores: scores };
});
