/* gm/frontpage.js — the front page (suite ticket 5.2, switch between.frontpage).

   Window.B68GmFrontPage, and module.exports under Node. GM-side only. `/blade front page` (Claude Code, in the vault; no model here) drafts the broadsheet
   as a note from the transcript, the captures and the Aftermath data; the GM edits it in Obsidian and pastes it into Menu -> Front page. This file reads
   that note, draws it in a newspaper look, prints it, and puts its headline on the iPad. The format is in docs/canon-and-frontpage.md.

   Only the known parts of the note are ever read: the frontmatter (masthead, issue, date), the H1 headline, a "> " standfirst, and the sections
   Account, Name and Hook. Every other heading (a "GM notes" section, say) is dropped here, so what the page draws, prints and sends is only what is
   meant for the table. Everything drawn is escaped text.

   Pure (Node tests): parseNote(text) -> { masthead, issue, date, headline, standfirst, account[], name, hook, ok, problems[] }
                      html(fp) -> the article    css()    document(fp) -> a whole printable page    facts(fp) -> the fields the absent packet carries
   Page: make(host) -> { open(), toggle(), current() -> Promise<fp|null>, print(), headline() }
         host: { docs: { get(kind, owner) -> Promise<row json|null>, put(row) -> Promise, del(kind, owner) -> Promise }, show(kind, payload, opts), toast(msg, bad?),
                 root(), print(html) , now?() } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmFrontPage = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'frontpage', LIMITS = { masthead: 60, issue: 40, date: 40, headline: 120, standfirst: 240, para: 600, name: 200, hook: 240, paras: 6 };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* one line of plain text: wikilinks to their label, emphasis marks and block ids dropped, control characters spaced out */
  function plain(s, max) {
    var t = str(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\s\^[A-Za-z0-9-]+\s*$/, '').replace(/(\*\*|__|\*|_|`)/g, '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
  }

  function parseNote(text) {
    var lines = str(text).replace(/^﻿/, '').split(/\r?\n/), fm = {}, i = 0, problems = [];
    if (lines[0] === '---') {
      for (i = 1; i < lines.length && lines[i] !== '---'; i++) { var m = /^([A-Za-z_]+):\s*(.*)$/.exec(lines[i]); if (m) fm[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, ''); }
      i++;
    }
    var fp = { masthead: plain(fm.masthead, LIMITS.masthead), issue: plain(fm.issue, LIMITS.issue), date: plain(fm.date, LIMITS.date), headline: '', standfirst: '', account: [], name: '', hook: '', ok: false, problems: problems };
    var sec = '', buf = {}, para = [];
    function flush() { if (para.length && sec) (buf[sec] = buf[sec] || []).push(para.join(' ')); para = []; }
    for (; i < lines.length; i++) {
      var l = lines[i], h1 = /^#\s+(.+)$/.exec(l), h2 = /^##\s+(.+)$/.exec(l), q = /^>\s?(.*)$/.exec(l);
      if (h1 && !fp.headline) { flush(); fp.headline = plain(h1[1], LIMITS.headline); sec = '_'; continue; }
      if (h2) { flush(); var n = h2[1].trim().toLowerCase(); sec = n === 'account' ? 'account' : /^(misspelt name|misspelled name|name)$/.test(n) ? 'name' : n === 'hook' ? 'hook' : '_x'; continue; }
      if (/^#{1,6}\s/.test(l)) { flush(); sec = '_x'; continue; }
      if (sec === '_' && q && !fp.standfirst) { fp.standfirst = plain(q[1], LIMITS.standfirst); continue; }
      if (sec === '_x' || sec === '_' || !sec) continue;
      if (/^\s*$/.test(l)) { flush(); continue; }
      if (/^>\s*\[!/.test(l)) { flush(); sec = '_x'; continue; }
      para.push(l.replace(/^\s*[-*]\s+/, '').replace(/^>\s?/, '').trim());
    }
    flush();
    fp.account = (buf.account || []).slice(0, LIMITS.paras).map(function (p) { return plain(p, LIMITS.para); }).filter(Boolean);
    fp.name = plain((buf.name || []).join(' '), LIMITS.name);
    fp.hook = plain((buf.hook || []).join(' '), LIMITS.hook);
    if (!fp.headline) problems.push('no headline (a line starting "# ")');
    if (!fp.account.length) problems.push('no account (a "## Account" section)');
    if (!fp.name) problems.push('no misspelt name (a "## Name" section)');
    if (!fp.hook) problems.push('no hook (a "## Hook" section)');
    fp.ok = !!fp.headline && fp.account.length > 0;
    return fp;
  }

  function css() {
    return '.b68-fp{font-family:Georgia,"Times New Roman",serif;color:#1c1a17;background:#efe8d6;padding:18px 22px;max-width:760px;margin:0 auto;border:1px solid #1c1a17}' +
      '.b68-fp .fp-mast{font-size:44px;font-weight:700;text-align:center;letter-spacing:.02em;border-bottom:3px double #1c1a17;padding-bottom:6px}' +
      '.b68-fp .fp-dateline{display:flex;justify-content:space-between;font-size:12px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #1c1a17;padding:4px 0;margin-bottom:12px}' +
      '.b68-fp h1{font-size:34px;line-height:1.1;margin:6px 0 4px}.b68-fp .fp-stand{font-style:italic;margin:0 0 10px}' +
      '.b68-fp .fp-cols{column-count:2;column-gap:22px;text-align:justify;font-size:15px;line-height:1.35}.b68-fp .fp-cols p{margin:0 0 8px;text-indent:1em}.b68-fp .fp-cols p:first-child{text-indent:0}' +
      '.b68-fp .fp-aside{border:1px solid #1c1a17;margin-top:12px;padding:6px 10px;font-size:14px}.b68-fp .fp-aside b{text-transform:uppercase;font-size:11px;letter-spacing:.1em;display:block}' +
      '@media print{.b68-fp{border:0;background:#fff}}';
  }
  function html(fp) {
    if (!isObj(fp) || !fp.headline) return '<p class="gm-empty">No front page yet.</p>';
    return '<article class="b68-fp"><div class="fp-mast">' + esc(fp.masthead || 'The Daily Paper') + '</div><div class="fp-dateline"><span>' + esc(fp.issue) + '</span><span>' + esc(fp.date) + '</span></div>' +
      '<h1>' + esc(fp.headline) + '</h1>' + (fp.standfirst ? '<p class="fp-stand">' + esc(fp.standfirst) + '</p>' : '') +
      '<div class="fp-cols">' + (fp.account || []).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
      (fp.name ? '<div class="fp-aside"><b>Also in the news</b>' + esc(fp.name) + '</div>' : '') +
      (fp.hook ? '<div class="fp-aside"><b>Developing</b>' + esc(fp.hook) + '</div>' : '') + '</article>';
  }
  function document_(fp) { return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc(fp.masthead || 'Front page') + '</title><style>body{margin:0;padding:12px}' + css() + '</style></head><body>' + html(fp) + '</body></html>'; }
  /* what the absent packet carries: the same cleaned fields, nothing else */
  function facts(fp) {
    if (!isObj(fp) || !fp.headline) return null;
    return { masthead: fp.masthead || '', issue: fp.issue || '', date: fp.date || '', headline: fp.headline, standfirst: fp.standfirst || '', account: (fp.account || []).slice(0, LIMITS.paras), name: fp.name || '', hook: fp.hook || '' };
  }

  /* the title beat holds 80 characters (functions/_lib/show.js): cut at a word boundary, no ellipsis */
  function titleText(t) { t = str(t); if (t.length <= 80) return t; var c = t.slice(0, 80), i = c.lastIndexOf(' '); return (i > 20 ? c.slice(0, i) : c).replace(/[ ,;:.-]+$/, ''); }

  function make(host) {
    var h = host || {}, ctl = {}, cached = null;
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    ctl.current = function () {
      if (cached) return Promise.resolve(cached);
      return Promise.resolve(h.docs ? h.docs.get(KIND, '_') : null).then(function (j) { cached = isObj(j) && typeof j.text === 'string' ? parseNote(j.text) : null; return cached; }, function () { return null; });
    };
    ctl.save = function (text) {
      var fp = parseNote(text);
      if (!fp.ok) { say('That is not a front page yet: ' + fp.problems.join('; ') + '.', true); return Promise.resolve(null); }
      var at = typeof h.now === 'function' ? h.now() : Date.now();
      return Promise.resolve(h.docs.put({ kind: KIND, owner: '_', scope: 'gm', json: { v: 1, text: str(text).slice(0, 20000), at: at } })).then(function () { cached = fp; return fp; }, function (e) { say('The front page was not saved: ' + (e && e.message || 'try again'), true); return null; });
    };
    ctl.headline = function () {
      return ctl.current().then(function (fp) {
        if (!fp) { say('No front page saved yet.', true); return null; }
        return h.show('title', { text: titleText(fp.headline), sub: fp.masthead || 'Front page' }, { ms: 12000, key: 'frontpage-' + fp.headline.length });
      });
    };
    ctl.print = function () {
      return ctl.current().then(function (fp) { if (!fp) { say('No front page saved yet.', true); return false; } if (typeof h.print === 'function') h.print(document_(fp)); return true; });
    };
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'frontpage', 'Front page') : null; }
    ctl.render = function (box) {
      if (!box) return;
      ctl.current().then(function (fp) {
        box.innerHTML = '<p class="gm-dim">Paste the note <code>/blade front page</code> wrote (after you have edited it). Only the headline, standfirst, Account, Name and Hook are used.</p>' +
          '<div class="gm-sb-row"><textarea data-fp-text rows="8" style="width:100%"></textarea></div>' +
          '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-fp="save">Save and preview</button> <button type="button" class="btn sm" data-fp="print"' + (fp ? '' : ' disabled') + '>Print</button> ' +
          '<button type="button" class="btn sm" data-fp="show"' + (fp ? '' : ' disabled') + '>Headline on the iPad</button></div><style>' + css() + '</style><div data-fp-view>' + html(fp) + '</div>';
        var sh = box.parentNode;
        if (sh && !sh.__fp) {
          sh.__fp = true;
          sh.addEventListener('click', function (ev) {
            var t = ev.target && ev.target.closest ? ev.target.closest('[data-fp]') : null; if (!t) return;
            var a = t.getAttribute('data-fp');
            if (a === 'save') { var ta = sh.querySelector('[data-fp-text]'); ctl.save(ta ? ta.value : '').then(function (fp2) { if (fp2) ctl.render(box); }); }
            else if (a === 'print') ctl.print(); else if (a === 'show') ctl.headline();
          });
        }
      });
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, parseNote: parseNote, html: html, css: css, document: document_, facts: facts, titleText: titleText, KIND: KIND, LIMITS: LIMITS };
});
