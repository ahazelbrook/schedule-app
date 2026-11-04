/* gm/absent.js — the absent-player packet, GM side (suite ticket 5.7, switch between.absent).

   Window.B68GmAbsent, and module.exports under Node. For a player marked absent the GM sends ONE page to their phone (app/sheet/absent.js draws it):
     1. the front page            (gm/frontpage.js: the cleaned fields of the note the GM saved)
     2. "Previously on"           the faces of NPCs the table has met (revealed ones only, at most 6) and exactly three lines, which fit in about 90 seconds
     3. the changes to their sheet   a plain-language diff of THEIR OWN character since the packet last sent (or since the first packet), plus any lines the GM adds
   It is a row in the docs store: kind 'packet', owner = that player, scope 'player'. The store shows it to that player and the GM only; the display and the
   other players never read it. Nothing pushes a scene to a phone: the row sits there until the player opens it.

   Secrecy. Faces come from NPCs with `revealed === true` (or a first-seen time) and carry only a name and a role. The diff reads only the player's own
   character document and names only fields on the sheet itself. The front page is the cleaned public note (never its GM notes section). A packet that fails
   these checks is not sent.

   Pure (Node tests): packet(input) -> the row json | null      facesOf(npcs)      snapOf(doc)      diffSheet(before, snapOrDoc)      cleanLines(raw, n)
   Page: make(host) -> { marked(), mark(id, on), send(), withdraw(), members(), open(), toggle() }
         host: { members() -> Promise<[{id,name}]>, characters() -> Promise<[{id, doc}]>, npcs() -> Promise<[npc doc]>, docs: { get(kind, owner), put(row), del(kind, owner) },
                 frontPage() -> Promise<fp|null>, toast(msg, bad?), root(), now?() } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmAbsent = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'packet', FACES = 6, LINES = 3, LINE_MAX = 160, CHANGES = 12, CHANGE_MAX = 160, ROLE_MAX = 40, NAME_MAX = 40;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function one(s, max) { var t = str(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  function cleanLines(raw, n) {
    var list = Array.isArray(raw) ? raw : str(raw).split(/\r?\n/);
    return list.map(function (l) { return one(str(l).replace(/^\s*[-*\d.)]+\s+/, ''), LINE_MAX); }).filter(Boolean).slice(0, n);
  }
  /* the NPCs the table has met and no others: a hidden one never reaches a phone */
  function facesOf(npcs) {
    var out = [];
    (Array.isArray(npcs) ? npcs : []).forEach(function (n) {
      if (out.length >= FACES || !isObj(n) || !(n.revealed === true || n.firstSeen)) return;
      var name = one(n.name, NAME_MAX); if (!name) return;
      out.push({ name: name, role: one(n.role, ROLE_MAX) });
    });
    return out;
  }

  var XP = [['playbook', 'Playbook xp'], ['insight', 'Insight xp'], ['prowess', 'Prowess xp'], ['resolve', 'Resolve xp']];
  function harmList(h) {
    var out = [];
    if (!isObj(h)) return out;
    ['l1', 'l2', 'l3', 'l4'].forEach(function (k) { [].concat(h[k] == null ? [] : h[k]).forEach(function (t) { var s = one(t, 60); if (s) out.push(k.toUpperCase().replace('L', 'Level ') + ': ' + s); }); });
    return out;
  }
  function names(list) { return (Array.isArray(list) ? list : []).map(function (x) { return one(isObj(x) ? x.name || x.text : x, 60); }).filter(Boolean); }
  /* a small snapshot of one character's own sheet: only fields the player sees on their own sheet */
  function snapOf(doc) {
    var p = isObj(doc) && isObj(doc.play) ? doc.play : {}, xp = isObj(p.xp) ? p.xp : {};
    return { stress: num(p.stress), xp: { playbook: num(xp.playbook), insight: num(xp.insight), prowess: num(xp.prowess), resolve: num(xp.resolve) }, harm: harmList(p.harm),
      bank: num(p.bank), stacks: num(p.stacks), abilities: names(p.abilities), items: names(p.items) };
  }
  function listDiff(before, after, gained, lost, out) {
    after.filter(function (x) { return before.indexOf(x) < 0; }).forEach(function (x) { out.push(gained + ': ' + x); });
    before.filter(function (x) { return after.indexOf(x) < 0; }).forEach(function (x) { out.push(lost + ': ' + x); });
  }
  function diffSheet(before, after) {
    var a = isObj(after) && isObj(after.play) ? snapOf(after) : isObj(after) ? after : null;
    if (!a || !isObj(before)) return [];
    var b = before, out = [];
    if (num(b.stress) !== a.stress) out.push('Stress ' + num(b.stress) + ' to ' + a.stress);
    XP.forEach(function (x) { var was = num(isObj(b.xp) ? b.xp[x[0]] : 0), now = a.xp[x[0]]; if (was !== now) out.push(x[1] + ' ' + was + ' to ' + now); });
    listDiff(Array.isArray(b.harm) ? b.harm : [], a.harm, 'New harm', 'Healed', out);
    if (num(b.bank) !== a.bank) out.push('Coin in the bank ' + num(b.bank) + ' to ' + a.bank);
    if (num(b.stacks) !== a.stacks) out.push('Stash ' + num(b.stacks) + ' to ' + a.stacks);
    listDiff(Array.isArray(b.abilities) ? b.abilities : [], a.abilities, 'New ability', 'Ability gone', out);
    listDiff(Array.isArray(b.items) ? b.items : [], a.items, 'Item gained', 'Item gone', out);
    return out.map(function (l) { return one(l, CHANGE_MAX); }).slice(0, CHANGES);
  }

  /* input: { fp (the cleaned front page fields or null), npcs, recap (3 lines), notes (extra lines), before (an earlier snap or null), doc (their character), session?, now } */
  function packet(inp) {
    inp = isObj(inp) ? inp : {};
    var lines = cleanLines(inp.recap, LINES), fp = isObj(inp.fp) && inp.fp.headline ? inp.fp : null;
    if (lines.length !== LINES) return null;
    var snap = isObj(inp.doc) ? snapOf(inp.doc) : null, diff = snap && inp.before ? diffSheet(inp.before, snap) : [];
    var changes = diff.concat(cleanLines(inp.notes, CHANGES)).slice(0, CHANGES);
    return { v: 1, at: Math.floor(num(inp.now)), front: fp ? { masthead: one(fp.masthead, 60), issue: one(fp.issue, 40), date: one(fp.date, 40), headline: one(fp.headline, 120), standfirst: one(fp.standfirst, 240),
        account: (Array.isArray(fp.account) ? fp.account : []).slice(0, 6).map(function (p) { return one(p, 600); }).filter(Boolean), name: one(fp.name, 200), hook: one(fp.hook, 240) } : null,
      previously: { faces: facesOf(inp.npcs), lines: lines }, changes: changes, first: !inp.before, snap: snap };
  }

  function make(host) {
    var h = host || {}, ctl = {}, ticked = {}, recap = '', notes = '', busy = false;
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    ctl.marked = function () { return Object.keys(ticked).filter(function (k) { return ticked[k]; }); };
    ctl.mark = function (id, on) { ticked[id] = on !== false; };
    ctl.members = function () { return Promise.resolve(h.members ? h.members() : []); };
    ctl.send = function (opts) {
      opts = opts || {};
      var who = ctl.marked(), r = opts.recap !== undefined ? opts.recap : recap, n = opts.notes !== undefined ? opts.notes : notes;
      if (!who.length) { say('Tick a player who is absent first.', true); return Promise.resolve({ sent: 0 }); }
      if (cleanLines(r, LINES).length !== LINES) { say('The recap needs exactly three lines.', true); return Promise.resolve({ sent: 0 }); }
      if (busy) return Promise.resolve({ sent: 0, busy: true });
      busy = true;
      return Promise.all([ctl.members(), Promise.resolve(h.characters()), Promise.resolve(h.npcs()), Promise.resolve(h.frontPage ? h.frontPage() : null)]).then(function (a) {
        var chars = a[1] || [], npcs = a[2] || [], fp = a[3] ? (W && W.B68GmFrontPage ? W.B68GmFrontPage.facts(a[3]) : a[3]) : null;
        return Promise.all(who.map(function (id) {
          var mine = chars.filter(function (c) { return c && isObj(c.doc) && c.doc.owner === id; });
          return Promise.resolve(h.docs.get(KIND, id)).then(function (old) {
            var before = isObj(old) && isObj(old.snap) ? old.snap : null;
            var doc = mine.length ? mine[0].doc : null;
            var row = packet({ fp: fp, npcs: npcs, recap: r, notes: n, before: before, doc: doc, now: typeof h.now === 'function' ? h.now() : Date.now() });
            if (!row) return false;
            return Promise.resolve(h.docs.put({ kind: KIND, owner: id, scope: 'player', json: row })).then(function () { return true; });
          });
        }));
      }).then(function (res) { busy = false; var n2 = res.filter(Boolean).length; say('Packet sent to ' + n2 + ' player' + (n2 === 1 ? '' : 's') + '.'); return { sent: n2 }; },
        function (e) { busy = false; say('The packet did not send: ' + (e && e.message || 'try again'), true); return { sent: 0, error: true }; });
    };
    ctl.withdraw = function () { return Promise.all(ctl.marked().map(function (id) { return Promise.resolve(h.docs.del(KIND, id)).then(null, function () { return null; }); })).then(function () { say('Packet withdrawn.'); }); };

    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'absent', 'Absent packet') : null; }
    ctl.render = function (box) {
      if (!box) return;
      ctl.members().then(function (ms) {
        box.innerHTML = '<p class="gm-dim">Tick who is absent, write three lines for "Previously on", then send. They also get the saved front page and the changes to their own sheet.</p>' +
          '<div>' + (ms.length ? ms.map(function (m) { return '<label class="gm-sb-row"><input type="checkbox" data-ab-who="' + esc(m.id) + '"' + (ticked[m.id] ? ' checked' : '') + '> ' + esc(m.name || m.id) + '</label>'; }).join('') : '<p class="gm-empty">No players found.</p>') + '</div>' +
          '<div class="gm-sb-row"><label>Previously on (three lines) <textarea data-ab-recap rows="3" style="width:100%">' + esc(recap) + '</textarea></label></div>' +
          '<div class="gm-sb-row"><label>Anything to add to their changes (one per line, optional) <textarea data-ab-notes rows="2" style="width:100%">' + esc(notes) + '</textarea></label></div>' +
          '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-ab="send">Send the packet</button> <button type="button" class="btn sm" data-ab="withdraw">Withdraw it</button></div>';
        var sh = box.parentNode;
        if (sh && !sh.__ab) {
          sh.__ab = true;
          sh.addEventListener('change', function (ev) { var t = ev.target; if (t && t.getAttribute && t.getAttribute('data-ab-who')) ctl.mark(t.getAttribute('data-ab-who'), !!t.checked); });
          sh.addEventListener('input', function (ev) { var t = ev.target; if (!t || !t.hasAttribute) return; if (t.hasAttribute('data-ab-recap')) recap = t.value; else if (t.hasAttribute('data-ab-notes')) notes = t.value; });
          sh.addEventListener('click', function (ev) { var t = ev.target && ev.target.closest ? ev.target.closest('[data-ab]') : null; if (!t) return; if (t.getAttribute('data-ab') === 'send') ctl.send(); else ctl.withdraw(); });
        }
      });
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, packet: packet, facesOf: facesOf, snapOf: snapOf, diffSheet: diffSheet, cleanLines: cleanLines, KIND: KIND, LINES: LINES, FACES: FACES };
});
