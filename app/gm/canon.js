/* gm/canon.js — the canon queue's reader (suite ticket A4, switch ai.canon).

   Window.B68GmCanon, and module.exports under Node (scripts/lib/canon.mjs reads the same file, so the app and the script cannot disagree about a line).
   Pure: no DOM, no clock, no network, no model. The proposals are written into a vault note by a Claude Code command; the GM ticks the ones to keep; this
   file only READS that note. Format: docs/canon-and-frontpage.md.

   A proposal is one task-list line:
     - [x] PLAYER-SAFE npc [[Target Name]]: the fact, in one line ^optional-id
   tick     x or X is ticked; anything else ([ ], [-], [/], [?]) is not, and nothing is written for it.
   scope    GM-ONLY or PLAYER-SAFE (any case, optional brackets). A missing or unknown scope is GM-ONLY: it fails closed.
   kind     npc | faction | players   (players: something a player added at the table; it files on the note it is about)
   target   the wikilink, alias and heading dropped; the note it files on.
   id       the trailing ^id, else a hash of scope, kind, target and text, so the same line has the same id on every run.

   API: parseQueue(text) -> { items, warnings }     idOf(item) -> string     summary(items) -> { total, ticked, unticked, gmOnly, playerSafe, ... }
        KINDS SCOPES    MAX_TEXT */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCanon = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KINDS = ['npc', 'faction', 'players'], SCOPES = ['gm', 'player'], MAX_TEXT = 400;
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clean(s) { return str(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* FNV-1a, 32 bits, as 8 hex digits: stable, no crypto needed in a browser */
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function idOf(it) { return 'c' + hash([it.scope, it.kind, it.target.toLowerCase(), it.text].join('|')); }

  /* the part of the line after the tick: [SCOPE] kind [[Target]]: text ^id */
  var LINE = /^\s*[-*+]\s+\[(.)\]\s+(.*?)\s*$/;
  var BODY = /^(?:\[?\s*(GM-ONLY|GM ONLY|PLAYER-SAFE|PLAYER SAFE)\s*\]?\s+)?(?:\[?\s*([A-Za-z]+)\s*\]?\s+)?\[\[([^\]]+)\]\]\s*[:—–-]\s*(.*)$/i;

  function parseQueue(text) {
    var items = [], warnings = [], seen = {};
    var lines = str(text).split(/\r?\n/), inFm = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (i === 0 && raw.replace(/^﻿/, '') === '---') { inFm = true; continue; }
      if (inFm) { if (raw === '---') inFm = false; continue; }
      var m = LINE.exec(raw);
      if (!m) continue;
      var mark = m[1], rest = m[2];
      var b = BODY.exec(rest);
      if (!b) { warnings.push({ line: i + 1, msg: 'a task line the queue does not understand; skipped' }); continue; }
      var kind = str(b[2]).toLowerCase();
      if (KINDS.indexOf(kind) < 0) { warnings.push({ line: i + 1, msg: 'unknown kind "' + clean(b[2]) + '" (npc, faction or players); skipped' }); continue; }
      var scopeWord = str(b[1]).toUpperCase().replace(/\s+/g, '-');
      var scope = scopeWord === 'PLAYER-SAFE' ? 'player' : 'gm';
      if (!scopeWord) warnings.push({ line: i + 1, msg: 'no scope tag: treated as GM-ONLY' });
      var target = clean(b[3].split('|')[0].split('#')[0]);
      var body = b[4], explicit = null;
      var idm = /\s\^([A-Za-z0-9-]{1,40})\s*$/.exec(' ' + body);
      if (idm) { explicit = idm[1]; body = body.slice(0, body.length - idm[0].length + 1); }
      var t = clean(body);
      if (!target) { warnings.push({ line: i + 1, msg: 'no target note; skipped' }); continue; }
      if (!t) { warnings.push({ line: i + 1, msg: 'no text; skipped' }); continue; }
      if (t.length > MAX_TEXT) { warnings.push({ line: i + 1, msg: 'text longer than ' + MAX_TEXT + ' characters; skipped' }); continue; }
      var it = { line: i + 1, done: mark === 'x' || mark === 'X', scope: scope, kind: kind, target: target, text: t };
      it.id = explicit || idOf(it);
      if (seen[it.id]) { warnings.push({ line: i + 1, msg: 'repeats the id of line ' + seen[it.id] + '; skipped' }); continue; }
      seen[it.id] = i + 1;
      items.push(it);
    }
    return { items: items, warnings: warnings };
  }

  function summary(items) {
    var s = { total: 0, ticked: 0, unticked: 0, gmOnly: 0, playerSafe: 0, tickedGmOnly: 0, tickedPlayerSafe: 0 };
    (Array.isArray(items) ? items : []).forEach(function (it) {
      s.total++;
      if (it.done) s.ticked++; else s.unticked++;
      if (it.scope === 'player') { s.playerSafe++; if (it.done) s.tickedPlayerSafe++; } else { s.gmOnly++; if (it.done) s.tickedGmOnly++; }
    });
    return s;
  }

  return { parseQueue: parseQueue, idOf: idOf, summary: summary, KINDS: KINDS, SCOPES: SCOPES, MAX_TEXT: MAX_TEXT };
});
