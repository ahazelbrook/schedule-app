/* gm/npc-find.js: any NPC by name (gm.glance), RK24 of the room key build. It is in the gm-glance bundle (app/routes.js), fetched only while its setting is on.
   A search box at the top of the Cast panel (key N; no new key: Ctrl+K stays Prep's Find). Typing narrows the cast to the names (and aliases) that match,
   a short list of buttons shows who, and choosing one (or the only match, or Enter for the first) opens that NPC's card under the box.
   The card is the GM's: the look line, then what the GM notes hold under Voice, Tell, Signature, Wants and Knows (a field the notes do not hold is not shown:
   nothing is made up), the other notes, and a Who is button that asks Blade's existing Ask seat (POST /gm/assist/ask, the same call as the Blade panel's
   question field; the answer is also filed there as a card). The card never reveals an NPC and never sends anything to the iPad or a phone: a hidden NPC
   is searchable (the Cast panel is the GM's screen already) and wears the word Hidden.
   Plain script, UMD: window.B68GmNpcFind in the browser, module.exports under Node. ES5, as the files beside it. Reads other modules (B68Ui, B68GmEsc, B68Load)
   only when called.

   PURE (also under Node, checks/runtime/gm-npc-find.test.mjs)
     norm(s)                  lower case, accents off, anything but a letter or digit is a space, one space between words
     match(list, q)           list [{ id, doc: { name, alias } }] (alias a string or a list); -> [{ id, rank }] best first, then by name; every word typed must find a
                              word of the name or an alias (the start of a word ranks first, then inside a word); name before alias; an empty query finds no one
     notesOf(gmNotes)         -> { voice, tell, signature, want, knows, rest: [line] } from the labelled lines of the notes (Voice:, Tell:, Signature:, Want(s):, Know(s):)
   THE BOX
     create(host) -> { before(box), mount(box, keep), state() }
       host  { npcs() -> [{ id, doc }], ask(question) -> Promise<{ answer } | { error } | null>, canAsk() -> bool, redraw()?, ui?, doc? }
       before(box)       call before the page redraws the cast panel: remembers the focus and the caret of the search field
       mount(box, keep)  call after: puts the box first in the panel, paints it, hands the focus back; its listeners are on the panel, once
     Esc: the open card is registered with B68GmEsc (an in-view panel, priority 40), so Esc shuts it; there is no listener of its own on the document. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmNpcFind = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var MAX_LIST = 8, NOTE_MAX = 300, REST_MAX = 12, NONE = 999;
  function str(v) { return typeof v === 'string' ? v : ''; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function clip(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- pure ---------- */
  function norm(s) {
    s = str(s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: plain names still work */ }
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
  }
  function aliasList(a) { return (Array.isArray(a) ? a : [a]).map(str).filter(Boolean); }
  /* how a word typed finds a field: 0 the word itself, 1 the start of a word, 2 inside a word, 9 not at all */
  function wordRank(t, field) {
    var best = 9, ws = field ? field.split(' ') : [];
    for (var i = 0; i < ws.length; i++) {
      if (ws[i] === t) return 0;
      if (ws[i].indexOf(t) === 0) best = Math.min(best, 1);
      else if (ws[i].indexOf(t) > 0) best = Math.min(best, 2);
    }
    return best;
  }
  function rankOf(tokens, name, aliases, whole) {
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var best = wordRank(tokens[i], name);
      for (var j = 0; j < aliases.length; j++) best = Math.min(best, 3 + wordRank(tokens[i], aliases[j]));      /* a match in an alias ranks after the same match in the name */
      if (best >= 9) return NONE;
      total += best;
    }
    return name.indexOf(whole) === 0 ? total - 1 : total;      /* the name begins with what was typed */
  }
  function match(list, q) {
    var whole = norm(q), tokens = whole ? whole.split(' ') : [], out = [];
    if (!tokens.length || !Array.isArray(list)) return out;
    list.forEach(function (x) {
      var d = x && isObj(x.doc) ? x.doc : null; if (!d || !str(x.id)) return;
      var nm = norm(d.name), al = aliasList(d.alias).map(norm).filter(Boolean), r = rankOf(tokens, nm, al, whole);
      if (r < NONE) out.push({ id: x.id, rank: r, name: nm });
    });
    out.sort(function (a, b) { return a.rank !== b.rank ? a.rank - b.rank : a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out.map(function (x) { return { id: x.id, rank: x.rank }; });
  }

  var LABELS = { voice: 'voice', tell: 'tell', signature: 'signature', want: 'want', wants: 'want', wanting: 'want', goal: 'want', know: 'knows', knows: 'knows', knowledge: 'knows' };
  function notesOf(gmNotes) {
    var o = { voice: '', tell: '', signature: '', want: '', knows: '', rest: [] };
    str(gmNotes).split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim(); if (!line) return;
      var m = /^([A-Za-z][A-Za-z ]{0,14}?)\s*:\s*(.*)$/.exec(line), key = m ? LABELS[m[1].toLowerCase()] : '';
      if (key && m[2].trim()) o[key] = o[key] ? o[key] + '; ' + clip(m[2], NOTE_MAX) : clip(m[2], NOTE_MAX);
      else if (!key && o.rest.length < REST_MAX) o.rest.push(clip(line, NOTE_MAX));
    });
    return o;
  }
  /* the words of an Ask answer card, for the card's own line: its headline, its bullets and its More text */
  function answerText(a) {
    if (!isObj(a)) return '';
    var parts = [str(a.headline) || str(a.text)];
    (Array.isArray(a.bullets) ? a.bullets : []).forEach(function (b) { parts.push('• ' + str(b)); });
    if (str(a.more)) parts.push(str(a.more));
    return parts.filter(Boolean).join('\n').slice(0, 1600);
  }

  /* ---------- the box ---------- */
  function create(host) {
    host = host || {};
    var ST = { q: '', open: '', who: {}, node: null, box: null, waited: false, esc: null };

    function ui() { var U = host.ui || (W && W.B68Ui) || null; return U && typeof U.button === 'function' && typeof U.field === 'function' ? U : null; }
    function doc() { return host.doc || (W && W.document) || null; }
    function cast() { var l = typeof host.npcs === 'function' ? host.npcs() : []; return Array.isArray(l) ? l : []; }
    function byId(id) { var l = cast(); for (var i = 0; i < l.length; i++) if (l[i].id === id && isObj(l[i].doc)) return l[i].doc; return null; }
    function matches() { return match(cast(), ST.q); }
    function btn(label, o) { return ui().button({ label: label, rank: o.rank || 'quiet', cls: 'chip sm gl-b ' + (o.cls || ''), data: o.data, title: o.title, disabled: o.disabled, attrs: o.attrs }); }

    function listHtml(ms) {
      if (!str(ST.q).trim()) return '';
      if (!ms.length) return '<p class="gl-find-note" role="status">No one by that name.</p>';
      var shown = ms.slice(0, MAX_LIST), more = ms.length - shown.length;
      return '<p class="gl-find-note" role="status">' + ms.length + (ms.length === 1 ? ' match' : ' matches') + '</p><ul class="gl-find-list">' + shown.map(function (m) {
        var d = byId(m.id) || {}, sub = [str(d.role), str(d.faction)].filter(Boolean).join(' · '), on = ST.open === m.id;
        return '<li class="gl-find-li">' + btn(str(d.name) || 'Unnamed', { cls: 'gl-find-pick' + (on ? ' is-on' : ''), data: { glf: 'pick', id: m.id }, attrs: { 'aria-pressed': on ? 'true' : 'false' } }) +
          (sub ? '<small class="gl-find-sub">' + esc(sub) + '</small>' : '') + (d.revealed === true ? '' : '<span class="gm-badge gl-find-hid">Hidden</span>') + '</li>';
      }).join('') + '</ul>' + (more > 0 ? '<p class="gl-find-note">and ' + more + ' more: type more of the name.</p>' : '');
    }
    function factRow(k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : ''; }
    function cardHtml() {
      var d = ST.open ? byId(ST.open) : null; if (!d) return '';
      var n = notesOf(d.gmNotes), facts = factRow('Voice', n.voice) + factRow('Tell', n.tell) + factRow('Signature', n.signature) + factRow('Wants', n.want) + factRow('Knows', n.knows);
      var al = aliasList(d.alias).join(', '), sub = [str(d.role), str(d.faction)].filter(Boolean).join(' · '), w = ST.who[ST.open] || {}, can = typeof host.canAsk === 'function' && host.canAsk();
      var say = w.busy ? 'Asking Blade…' : w.err ? w.err : '';
      return '<section class="gl-find-card" data-gl-card="' + esc(ST.open) + '" aria-label="' + esc(str(d.name) || 'NPC') + '">' +
        '<h4 class="gl-find-name">' + esc(str(d.name) || 'Unnamed') + (al ? ' <span class="gl-find-al">“' + esc(al) + '”</span>' : '') + '</h4>' +
        (sub ? '<p class="gl-find-line">' + esc(sub) + '</p>' : '') +
        (d.revealed === true ? '' : '<p class="gl-find-line gl-find-hidnote"><span class="gm-badge">Hidden</span> Not shown to the players. Nothing on this card is sent.</p>') +
        (str(d.description) ? '<p class="gl-find-look">' + esc(clip(d.description, 600)) + '</p>' : '') +
        (facts ? '<dl class="gl-find-facts">' + facts + '</dl>' : '') +
        (n.rest.length ? '<ul class="gl-find-rest">' + n.rest.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '') +
        (!facts && !n.rest.length && !str(d.description) ? '<p class="gl-find-line">Nothing is filed on them yet.</p>' : '') +
        '<div class="gl-find-acts">' + btn('Who is', { rank: 'standard', cls: 'gl-find-who', data: { glf: 'who', id: ST.open }, disabled: !can || !!w.busy, title: can ? 'Ask Blade who they are: for your eyes only' : 'Blade cannot be asked just now' }) +
        btn('Close', { cls: 'gl-find-close', data: { glf: 'close' } }) + '</div>' +
        '<div class="gl-find-answer" role="status" aria-live="polite"' + (say || w.text ? '' : ' hidden') + '>' + (say ? '<p class="gl-find-line">' + esc(say) + '</p>' : '') + (w.text ? '<p class="gl-find-text">' + esc(w.text) + '</p>' : '') + '</div></section>';
    }
    function barHtml() {
      return '<div class="gl-find-bar">' + ui().field({ kind: 'search', label: 'Find an NPC', id: 'gl-find-q', cls: 'gl-find-q', value: ST.q, placeholder: 'Name or alias', attrs: { autocomplete: 'off', spellcheck: 'false', maxlength: '60' } }) +
        btn('Clear', { cls: 'gl-find-clear', data: { glf: 'clear' }, disabled: !ST.q }) + '</div>';
    }
    /* everything under the field is redrawn as the query changes; the field itself is not (it would lose the caret) */
    function paintOut(node) {
      var out = node.querySelector('.gl-find-out'); if (!out) return;
      if (ST.open && matches().every(function (m) { return m.id !== ST.open; })) ST.open = '';
      out.innerHTML = listHtml(matches()) + cardHtml();
    }
    function repaint() { if (ST.node && ST.node.parentNode) paintOut(ST.node); }
    function escReg() {
      var E = W && W.B68GmEsc; if (!E || typeof E.register !== 'function' || ST.esc) return;
      ST.esc = E.register('npc-find', { priority: 40, isOpen: function () { return !!ST.open && !!ST.node && ST.node.isConnected !== false; }, close: function () { ST.open = ''; repaint(); } });
    }

    function pick(id) { ST.open = id; escReg(); repaint(); }
    function ask(id) {
      var d = byId(id), w = ST.who[id] = ST.who[id] || {}; if (!d || w.busy || typeof host.ask !== 'function') return;
      var name = str(d.name).trim(); if (!name) return;
      w.busy = true; w.err = ''; w.text = ''; repaint();
      var fin = function (r) {
        w.busy = false;
        if (isObj(r) && r.answer) w.text = answerText(r.answer);
        else if (r === null || r === undefined) w.err = 'Blade cannot be asked just now.';
        if (!w.text && !w.err) w.err = 'Blade had nothing to say to that. Try again.';
        repaint();
      };
      var p; try { p = host.ask('Who is ' + name + '? Voice, what they want and what they know, for the table.'); } catch (e) { p = null; }
      Promise.resolve(p).then(fin, function () { fin(false); });
    }

    function type(v) {
      ST.q = str(v).slice(0, 60); var ms = matches();
      ST.open = ms.length === 1 ? ms[0].id : (ms.some(function (m) { return m.id === ST.open; }) ? ST.open : '');      /* the only match opens its card */
      if (ST.open) escReg();
      if (ST.node) { paintOut(ST.node); var c = ST.node.querySelector('.gl-find-clear'); if (c) c.disabled = !ST.q; }
    }
    function onInput(ev) { var t = ev.target; if (t && t.id === 'gl-find-q') type(t.value); }
    function onKey(ev) {
      var t = ev.target; if (!t || t.id !== 'gl-find-q') return;
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { ev.preventDefault(); var ms = matches(); if (ms.length) pick(ms[0].id); }
    }
    function onClick(ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-glf]') : null; if (!t || !ST.node || !ST.node.contains(t)) return;
      var k = t.getAttribute('data-glf'), id = t.getAttribute('data-id') || '';
      if (k === 'pick') pick(id);
      else if (k === 'close') { ST.open = ''; repaint(); }
      else if (k === 'who') ask(id);
      else if (k === 'clear') {
        ST.q = ''; ST.open = ''; var q = ST.node.querySelector('#gl-find-q'); if (q) { q.value = ''; try { q.focus(); } catch (e) { /* none */ } }
        repaint(); t.disabled = true;
      }
    }

    function before(box) {
      var d = doc(), a = d && d.activeElement;
      if (a && a.id === 'gl-find-q' && box && box.contains(a)) { var k = { focus: true, a: 0, b: 0 }; try { k.a = a.selectionStart; k.b = a.selectionEnd; } catch (e) { /* none */ } return k; }
      return null;
    }
    function mount(box, keep) {
      var d = doc(); if (!box || !d) return null;
      if (!ui()) {      /* the UI kit is asked for once, and the box draws when it is in */
        if (!ST.waited && W && W.B68Load && typeof W.B68Load.need === 'function') { ST.waited = true; W.B68Load.need('kit-ui').then(function () { if (typeof host.redraw === 'function') host.redraw(); }, function () { ST.waited = false; }); }
        return null;
      }
      if (ST.box !== box) { ST.box = box; box.addEventListener('input', onInput); box.addEventListener('keydown', onKey); box.addEventListener('click', onClick); }
      var n = d.createElement('div'); n.className = 'gl-find'; n.setAttribute('data-gl-panel', 'find'); n.setAttribute('data-ui-scope', '');
      n.innerHTML = barHtml() + '<div class="gl-find-out"></div>';
      box.insertBefore(n, box.firstChild); ST.node = n; paintOut(n);
      if (keep && keep.focus) { var q = n.querySelector('#gl-find-q'); if (q) { try { q.focus(); if (typeof keep.a === 'number') q.setSelectionRange(keep.a, keep.b); } catch (e) { /* none */ } } }
      return n;
    }
    function html() { return barHtml() + '<div class="gl-find-out">' + listHtml(matches()) + cardHtml() + '</div>'; }
    return { before: before, mount: mount, type: type, pick: pick, ask: ask, html: html, state: function () { return { q: ST.q, open: ST.open, who: ST.who }; } };
  }

  return { create: create, _pure: { norm: norm, match: match, notesOf: notesOf, answerText: answerText } };
});
