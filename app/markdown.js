/* markdown.js — a small Markdown renderer for the rules wiki (rules.js, RULES.md), and the helpers that read an
   Obsidian note: frontmatter, [[wikilinks]], ![[embeds]], > [!callouts], and splitting a file into entries.
   window.B68Markdown:
     render(src, { resolve, headingOffset }) -> HTML string
     parseFrontmatter(text) -> { meta: { title, aliases: [], ... }, body }
     splitFile(path, text, { longSection, maxBytes }) -> [{ title, trail, keys, body }]   (the importer's split)
     plain(src) -> the text without its markup (search, snippets)
     safeUrl(u) -> { href, ext } | null,   esc(text) -> text safe in HTML
   Safety: nothing from the source reaches the page unescaped. Raw HTML is escaped, not passed through (so there is no
   sanitiser to get wrong); every piece of text goes through esc(); a link is only made for http, https or a relative
   address (javascript:, data:, vbscript: and any other scheme become plain text); a wikilink is only made for an entry
   the resolver knows, and its href comes from the resolver, never from the source. checks/runtime/markdown.test.mjs
   holds the cases. Plain ES5 so it also runs in node (the check loads it in a vm). */
(function () {
  'use strict';

  var MAX_DEPTH = 10;                       /* nested quotes / lists deeper than this are shown as text */

  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lines(text) { return String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^\t+/gm, function (t) { return new Array(t.length + 1).join('    '); }).split('\n'); }

  /* ---------- frontmatter ---------- */
  function unquote(v) {
    v = String(v).trim();
    var m = /^(["'])([\s\S]*)\1$/.exec(v);
    return m ? m[2] : v;
  }
  /* a, b, "c, d": split on commas outside quotes */
  function listOf(v) {
    var out = [], cur = '', q = '', i, c;
    v = String(v);
    for (i = 0; i < v.length; i++) {
      c = v.charAt(i);
      if (q) { if (c === q) q = ''; cur += c; }
      else if (c === '"' || c === "'") { q = c; cur += c; }
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(unquote).filter(function (x) { return x; });
  }
  /* YAML as far as an Obsidian note uses it: `key: value`, `key: [a, b]`, and `key:` followed by `- item` lines */
  function parseFrontmatter(text) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var m = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
    if (!m) return { meta: {}, body: text };
    var meta = {}, key = null;
    (m[1] || '').split('\n').forEach(function (ln) {
      var kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(ln), li;
      if (kv) {
        key = kv[1].toLowerCase();
        var v = kv[2].trim();
        if (v === '') meta[key] = [];
        else if (v.charAt(0) === '[' && v.charAt(v.length - 1) === ']') meta[key] = listOf(v.slice(1, -1));
        else meta[key] = unquote(v);
      } else if (key && (li = /^\s*-\s+(.*)$/.exec(ln))) {
        if (!Array.isArray(meta[key])) meta[key] = meta[key] ? [meta[key]] : [];
        meta[key].push(unquote(li[1]));
      }
    });
    var al = meta.aliases || meta.alias || [], aliases = Array.isArray(al) ? al : listOf(al);
    var title = typeof meta.title === 'string' ? meta.title.trim() : '';
    return { meta: { title: title, aliases: aliases, raw: meta }, body: text.slice(m[0].length) };
  }

  /* ---------- links ---------- */
  /* http, https or a relative address; anything else (javascript:, data:, vbscript:, //host ...) is null */
  function safeUrl(u) {
    u = String(u == null ? '' : u).trim();
    /* browsers ignore tabs, newlines and other control characters inside a scheme ("java\tscript:"), so test without them */
    var probe = u.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g, '');
    if (!probe) return null;
    if (/^[\/\\]{2}/.test(probe) || /^[\\]/.test(probe)) return null;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(probe)) return /^https?:\/\/[^\/]/i.test(probe) ? { href: u.replace(/\s/g, '%20'), ext: true } : null;
    return { href: u.replace(/\s/g, '%20'), ext: false };
  }
  var MEDIA = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|heic|tiff?|pdf|mp3|mp4|m4a|ogg|oga|wav|webm|mov|mkv|flac)$/i;

  /* [[Page|alias]], [[Page#Heading]], [[#Heading]]; embed = the ![[ ... ]] form */
  function wiki(embed, inner, ctx) {
    var bar = inner.indexOf('|'), target = (bar < 0 ? inner : inner.slice(0, bar)).trim(), alias = bar < 0 ? '' : inner.slice(bar + 1).trim();
    var hash = target.indexOf('#'), page = (hash < 0 ? target : target.slice(0, hash)).trim(), frag = hash < 0 ? '' : target.slice(hash + 1).trim();
    if (embed && MEDIA.test(page)) return '';                      /* an image or other file: dropped */
    var showFrag = frag && frag.charAt(0) !== '^' ? frag : '';
    var label = embed ? (page || frag) : (alias || (page ? page + (showFrag ? ' > ' + showFrag : '') : showFrag));
    if (!page) return esc(label);                                   /* [[#Heading]]: this page; plain text */
    var hit = ctx && typeof ctx.resolve === 'function' ? ctx.resolve(page, frag) : null;
    if (!hit || typeof hit.href !== 'string') return esc(label);    /* unresolved: plain text */
    return '<a class="rl-wl' + (embed ? ' rl-embed' : '') + '" href="' + esc(hit.href) + '">' + esc(label) + '</a>';
  }

  /* ---------- inline ---------- */
  function inline(src, ctx) {
    var ph = [];
    function hold(html) { ph.push(html); return '\u0000' + (ph.length - 1) + '\u0001'; }
    var t = String(src == null ? '' : src).replace(/[\u0000\u0001]/g, '');
    /* code spans first: nothing inside them is markup */
    t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, q, code) { return hold('<code>' + esc(code.replace(/^ ([\s\S]*) $/, '$1')) + '</code>'); });
    /* ![[embed]] and [[wikilink]] */
    t = t.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, function (m, bang, inner) { return hold(wiki(!!bang, inner, ctx)); });
    /* ![alt](url): no remote pictures; the alt text stays */
    t = t.replace(/!\[([^\]\n]*)\]\(([^)\n]*)\)/g, function (m, alt) { return alt ? hold('<span class="rl-img">' + esc(alt) + '</span>') : ''; });
    /* [text](url "title") */
    t = t.replace(/\[((?:[^\[\]\\\n]|\\.)*)\]\(\s*(<[^>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g, function (m, text, url) {
      url = url.replace(/^<|>$/g, '');
      if (/[\u0000\u0001]/.test(url)) return text;                  /* a code span or escape inside the address: not a link */
      var a = null, md = /^(.*?)\.md(#.*)?$/i.exec(url);
      if (md && !/^[a-z][a-z0-9+.\-]*:/i.test(url)) {                /* a link to a note file: an entry, or just text */
        var hit = ctx && typeof ctx.resolve === 'function' ? ctx.resolve(decodeSafe(md[1]).split('/').pop(), md[2] ? decodeSafe(md[2].slice(1)) : '') : null;
        a = hit && typeof hit.href === 'string' ? { href: hit.href, ext: false } : null;
      } else a = safeUrl(url);
      if (!a) return text;
      var plainText = text.replace(/https?:\/\//gi, function (x) { return hold(esc(x)); });   /* no link inside a link */
      return hold('<a href="' + esc(a.href) + '"' + (a.ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>') + plainText + hold('</a>');
    });
    /* backslash escapes */
    t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|>~<=^&"'])/g, function (m, c) { return hold(esc(c)); });
    /* bare http(s) addresses */
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<>"'`\u0000\u0001]+[^\s<>"'`.,;:!?)\]}\u0000\u0001])/g, function (m, pre, url) {
      var a = safeUrl(url);
      return a ? pre + hold('<a href="' + esc(a.href) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>') : m;
    });
    t = t.replace(/ \^[A-Za-z0-9-]+(?=\n|$)/g, '');                 /* Obsidian block ids */
    t = esc(t);
    t = t.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark class="rl-hl">$1</mark>');
    return t.replace(/\u0000(\d+)\u0001/g, function (m, k) { return ph[+k]; });
  }
  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /* ---------- blocks ---------- */
  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
  var RE_HEAD = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
  var RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?: +|$)(.*)$/;
  var RE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

  function splitRow(ln) {
    ln = ln.trim();
    if (ln.charAt(0) === '|') ln = ln.slice(1);
    if (ln.charAt(ln.length - 1) === '|' && ln.charAt(ln.length - 2) !== '\\') ln = ln.slice(0, -1);
    var cells = [], cur = '', i, c, tick = false;
    for (i = 0; i < ln.length; i++) {
      c = ln.charAt(i);
      if (c === '\\' && ln.charAt(i + 1) === '|') { cur += '|'; i++; }
      else if (c === '`') { tick = !tick; cur += c; }
      else if (c === '|' && !tick) { cells.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }
  function tableStarts(ln, next) {
    return ln.indexOf('|') >= 0 && next !== undefined && next.indexOf('-') >= 0 && RE_SEP.test(next) && splitRow(ln).length === splitRow(next).length;
  }
  function blockStart(ln, next) {
    return RE_HEAD.test(ln) || RE_FENCE.test(ln) || RE_HR.test(ln) || RE_QUOTE.test(ln) || RE_ITEM.test(ln) || tableStarts(ln, next);
  }
  function indentOf(ln) { return /^ */.exec(ln)[0].length; }
  function blank(ln) { return /^\s*$/.test(ln); }

  function renderTable(ls, ctx) {
    var head = splitRow(ls[0]), align = splitRow(ls[1]).map(function (c) { var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':'; return l && r ? 'c' : r ? 'r' : l ? 'l' : ''; });
    function cell(tag, text, i) { return '<' + tag + (align[i] ? ' class="al-' + align[i] + '"' : '') + '>' + inline(text, ctx) + '</' + tag + '>'; }
    var h = '<div class="rl-tablewrap"><table><thead><tr>' + head.map(function (c, i) { return cell('th', c, i); }).join('') + '</tr></thead><tbody>';
    ls.slice(2).forEach(function (ln) {
      var cs = splitRow(ln); while (cs.length < head.length) cs.push('');
      h += '<tr>' + cs.slice(0, head.length).map(function (c, i) { return cell('td', c, i); }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* a quote, or an Obsidian callout (> [!note] Title / > [!tip]- folded) */
  function renderQuote(ls, ctx) {
    var inner = ls.map(function (ln) { return ln.replace(/^ {0,3}> ?/, ''); });
    var co = /^\[!([A-Za-z0-9_-]+)\]([+-]?)[ \t]*(.*)$/.exec(inner[0]);
    if (!co) return '<blockquote>' + blocks(inner, ctx).join('') + '</blockquote>';
    var type = co[1].toLowerCase(), fold = co[2], title = co[3].trim() || (type.charAt(0).toUpperCase() + type.slice(1));
    var body = '<div class="rl-callout-body">' + blocks(inner.slice(1), ctx).join('') + '</div>';
    if (fold) return '<details class="rl-callout" data-callout="' + esc(type) + '"' + (fold === '+' ? ' open' : '') + '><summary class="rl-callout-title">' + inline(title, ctx) + '</summary>' + body + '</details>';
    return '<div class="rl-callout" data-callout="' + esc(type) + '"><div class="rl-callout-title">' + inline(title, ctx) + '</div>' + body + '</div>';
  }

  /* a list starting at ls[i]: returns { html, next } */
  function renderList(ls, i, ctx) {
    var first = RE_ITEM.exec(ls[i]), ordered = /\d/.test(first[2].charAt(0)), start = ordered ? parseInt(first[2], 10) : 1, items = [], n = ls.length;
    while (i < n) {
      var m = RE_ITEM.exec(ls[i]);
      if (!m || /\d/.test(m[2].charAt(0)) !== ordered) break;
      var ci = m[1].length + m[2].length + Math.min(4, Math.max(1, / */.exec(ls[i].slice(m[1].length + m[2].length))[0].length));
      var body = [m[3]], lastBlank = false;
      i++;
      while (i < n) {
        var ln = ls[i];
        if (blank(ln)) { body.push(''); lastBlank = true; i++; continue; }
        var ind = indentOf(ln);
        if (ind >= ci || (ind > m[1].length && RE_ITEM.test(ln))) { body.push(ln.slice(Math.min(ind, ci))); lastBlank = false; i++; continue; }
        if (!lastBlank && !blockStart(ln, ls[i + 1])) { body.push(ln.trim()); i++; continue; }   /* lazy continuation of the item's text */
        break;
      }
      while (body.length && body[body.length - 1] === '') body.pop();
      items.push(body);
      /* a blank line, then a sibling marker: the same list; anything else ends it */
      var j = i; while (j < n && blank(ls[j])) j++;
      var nm = j < n ? RE_ITEM.exec(ls[j]) : null;
      if (!nm || indentOf(ls[j]) >= ci || /\d/.test(nm[2].charAt(0)) !== ordered) break;
      i = j;
    }
    var tag = ordered ? 'ol' : 'ul', h = '<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>';
    items.forEach(function (body) {
      var task = /^\[([ xX])\][ \t]+/.exec(body[0]), box = '';
      if (task) { box = '<span class="rl-task' + (task[1] === ' ' ? '' : ' done') + '" aria-hidden="true">' + (task[1] === ' ' ? '\u2610' : '\u2611') + '</span> '; body[0] = body[0].slice(task[0].length); }
      var parts = blocks(body, ctx);
      if (parts.length && parts[0].slice(0, 3) === '<p>') parts[0] = parts[0].slice(3, -4);   /* a tight item: no paragraph around its text */
      h += '<li>' + box + parts.join('') + '</li>';
    });
    return { html: h + '</' + tag + '>', next: i };
  }

  function blocks(ls, ctx) {
    var out = [], i = 0, n = ls.length, m;
    ctx = ctx || {};
    var depth = ctx.depth || 0;
    if (depth > MAX_DEPTH) return ['<p>' + esc(ls.join('\n')).replace(/\n/g, '<br>') + '</p>'];
    var sub = { resolve: ctx.resolve, off: ctx.off, depth: depth + 1 };
    while (i < n) {
      var ln = ls[i];
      if (blank(ln)) { i++; continue; }
      if ((m = RE_FENCE.exec(ln))) {
        var fence = m[1], code = [];
        i++;
        while (i < n && !(new RegExp('^ {0,3}' + fence.charAt(0) + '{' + fence.length + ',}[ \\t]*$').test(ls[i]))) code.push(ls[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if ((m = RE_HEAD.exec(ln))) {
        var lvl = Math.min(6, m[1].length + (ctx.off || 0));
        out.push('<h' + lvl + '>' + inline(m[2], ctx) + '</h' + lvl + '>');
        i++; continue;
      }
      if (RE_HR.test(ln)) { out.push('<hr>'); i++; continue; }
      if (RE_QUOTE.test(ln)) {
        var q = [];
        while (i < n && RE_QUOTE.test(ls[i])) q.push(ls[i++]);
        out.push(renderQuote(q, sub)); continue;
      }
      if (tableStarts(ln, ls[i + 1])) {
        var t = [ln, ls[i + 1]];
        i += 2;
        while (i < n && !blank(ls[i]) && ls[i].indexOf('|') >= 0 && !RE_FENCE.test(ls[i])) t.push(ls[i++]);
        out.push(renderTable(t, ctx)); continue;
      }
      if (RE_ITEM.test(ln)) {
        var r = renderList(ls, i, sub);
        out.push(r.html); i = r.next; continue;
      }
      var buf = [ln];
      i++;
      while (i < n && !blank(ls[i]) && !blockStart(ls[i], ls[i + 1])) buf.push(ls[i++]);
      out.push('<p>' + inline(buf.join('\n').replace(/(?: {2,}|\\)\n/g, '\n'), ctx).replace(/\n/g, '<br>') + '</p>');
    }
    return out;
  }

  /* src: Markdown; opts.resolve(page, heading) -> { href } | null for wikilinks; opts.headingOffset (default 1: # is an h2) */
  function render(src, opts) {
    opts = opts || {};
    var body = parseFrontmatter(src).body.replace(/%%[\s\S]*?%%/g, '');
    return blocks(lines(body), { resolve: opts.resolve, off: opts.headingOffset == null ? 1 : opts.headingOffset, depth: 0 }).join('\n');
  }

  /* ---------- plain text, for search and snippets ---------- */
  function plain(src) {
    return parseFrontmatter(src).body
      .replace(/%%[\s\S]*?%%/g, ' ')
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      .replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g, function (m, p, h, a) { return a || ((p || '') + (h ? ' ' + h : '')); })
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[ \t]*>[ \t]*\[![A-Za-z0-9_-]+\][+-]?[ \t]*/gm, '')
      .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
      .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/gm, ' ')
      .replace(/[|`*_~=]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- the importer's split: one note file -> entries ---------- */
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /* body: Markdown without frontmatter. Sections start at every H1 and H2, and at H3 inside a section longer than
     opts.longSection characters. Headings inside code fences do not count. */
  function headingsOf(ls) {
    var out = [], fence = null, m, i;
    for (i = 0; i < ls.length; i++) {
      if ((m = /^ {0,3}(`{3,}|~{3,})/.exec(ls[i]))) {
        if (!fence) fence = m[1].charAt(0) + m[1].length;
        else if (m[1].charAt(0) === fence.charAt(0) && m[1].length >= +fence.slice(1)) fence = null;
        continue;
      }
      if (fence) continue;
      if ((m = /^ {0,3}(#{1,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(ls[i]))) out.push({ line: i, level: m[1].length, text: m[2].trim() });
    }
    return out;
  }

  /* cut a too-long body at blank lines (then at line ends, then anywhere) into pieces of at most `max` characters */
  function chunkText(body, max) {
    if (body.length <= max) return [body];
    var paras = body.split(/\n{2,}/), out = [], cur = '';
    function push() { if (cur.trim()) out.push(cur); cur = ''; }
    paras.forEach(function (p) {
      while (p.length > max) {                                          /* one paragraph longer than the limit */
        var cut = p.lastIndexOf('\n', max); if (cut < max / 2) cut = max;
        push(); out.push(p.slice(0, cut)); p = p.slice(cut).replace(/^\n/, '');
      }
      if (cur && cur.length + p.length + 2 > max) push();
      cur += (cur ? '\n\n' : '') + p;
    });
    push();
    return out;
  }

  function splitFile(path, text, opts) {
    opts = opts || {};
    var longAt = opts.longSection || 6000, maxChars = opts.maxChars || 36000;   /* 36000 characters are at most 108000 bytes: under the server's 120 KiB per entry */
    var fm = parseFrontmatter(text), ls = lines(fm.body);
    var parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
    var fileName = (parts.pop() || 'Untitled').replace(/\.md$/i, ''), folders = parts;
    var keys = [fm.meta.title].concat(fm.meta.aliases).filter(function (k, i, a) { return k && a.indexOf(k) === i; });
    var hs = headingsOf(ls);

    /* where sections start: every H1/H2; an H3 only when the H1/H2 section holding it is long */
    var starts = [];
    hs.forEach(function (h, k) {
      if (h.level <= 2) { starts.push(h); return; }
      var prev = null, next = null, j;
      for (j = k - 1; j >= 0; j--) if (hs[j].level <= 2) { prev = hs[j]; break; }
      for (j = k + 1; j < hs.length; j++) if (hs[j].level <= 2) { next = hs[j]; break; }
      var from = prev ? prev.line : 0, to = next ? next.line : ls.length;
      if (ls.slice(from, to).join('\n').length > longAt) starts.push(h);
    });

    function trailOf(chain) {                                           /* folders > file > headings, without repeats */
      var segs = folders.concat([fileName], chain), out = [];
      segs.forEach(function (s) { if (!out.length || norm(out[out.length - 1]) !== norm(s)) out.push(s); });
      return out;
    }
    var sections = [], pre = ls.slice(0, starts.length ? starts[0].line : ls.length).join('\n').trim();
    if (pre) sections.push({ title: fm.meta.title || fileName, chain: null, body: pre });
    var h1 = '', h2 = '';
    starts.forEach(function (h, k) {
      var body = ls.slice(h.line + 1, k + 1 < starts.length ? starts[k + 1].line : ls.length).join('\n').trim(), chain;
      if (h.level === 1) { h1 = h.text; h2 = ''; chain = []; }
      else if (h.level === 2) { h2 = h.text; chain = h1 ? [h1] : []; }
      else chain = (h1 ? [h1] : []).concat(h2 ? [h2] : []);
      sections.push({ title: h.text || fileName, chain: chain, body: body });
    });

    var out = [];
    sections.forEach(function (s) {
      if (!s.body) return;                                              /* a heading with nothing under it: only a trail */
      var trail = s.chain ? trailOf(s.chain) : folders.slice();
      if (norm(trail[trail.length - 1] || '') === norm(s.title)) trail.pop();   /* the title is not its own parent */
      chunkText(s.body, maxChars).forEach(function (piece, k) {
        out.push({ title: s.title + (k ? ' (part ' + (k + 1) + ')' : ''), trail: trail.join(' > '), keys: '', body: piece });
      });
    });
    if (out.length) out[0].keys = keys.join('\n');
    return out;
  }

  window.B68Markdown = { render: render, parseFrontmatter: parseFrontmatter, splitFile: splitFile, plain: plain, safeUrl: safeUrl, esc: esc, norm: norm };
})();
