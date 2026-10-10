/* schedule.js — when is the next session, who can make it (SCHEDULE.md). Three parts, one module:

   1. The data: `schedule` inside campaign/main. normalize() (a missing or odd schedule reads as the default), diff()
      (only the changed leaves, `null` for a removed key, so a PATCH carries e.g. {avail:{<me>:{o_x:'yes'}}} and two
      people answering at once never overwrite each other), the open options, the best option and quorum, the cadence
      ("Add the next three"), the countdown, the .ics file and the Google Calendar link.
   2. The schedule box on the table page. campaign.js owns the document, the saves and the gating; it calls box(doc,
      ctx) to draw and routes data-act "sched.*" to acts here (PERM says who may: 'gm' or 'any'). A player only ever
      changes schedule.avail.<me> and schedule.rsvp.<me>; campaign.js also strips anything else from a player's delta.
   3. The next-session card at the top of every mode (#nextSession). boot.js owns the campaign subscription and hands
      each snapshot to card.update(doc); the card writes only the viewer's own RSVP through api.save(patch).

   Times are stored as UTC instants and entered / shown in the viewer's local time. */
(function () {
  'use strict';
  var M = window.B68Schedule = window.B68Schedule || {};

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clamp(n, a, b) { n = Math.round(+n || 0); return n < a ? a : n > b ? b : n; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ms(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; }
  var H = 3600000, DAY = 86400000, PAST = 12 * H;
  var VALS = ['yes', 'maybe', 'no'], CYCLE = { '': 'yes', yes: 'maybe', maybe: 'no', no: '' };
  var LENGTHS = [120, 150, 180, 210, 240, 270, 300, 360, 420, 480];
  function minutes(v) { var n = Math.round(+v || 0); return n >= 30 && n <= 1440 ? n : 240; }
  function lenLabel(m) { var h = Math.floor(m / 60), r = m % 60; return (r === 30 ? h + '½' : r ? h + ':' + (r < 10 ? '0' : '') + r : String(h)) + ' h'; }
  function newOptionId() { return 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- the data ---------- */
  function defaults() { return { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0 }; }
  function normNext(n) {
    if (!isObj(n) || !ms(n.at)) return null;
    return { at: str(n.at), minutes: minutes(n.minutes), place: str(n.place), note: str(n.note), confirmedAt: typeof n.confirmedAt === 'string' && n.confirmedAt ? n.confirmedAt : null };
  }
  function normalize(s) {
    s = isObj(s) ? s : {};
    var out = defaults();
    if (isObj(s.options)) Object.keys(s.options).forEach(function (k) { var o = s.options[k]; if (isObj(o) && ms(o.at)) out.options[k] = { at: str(o.at), minutes: minutes(o.minutes), note: str(o.note) }; });
    if (isObj(s.avail)) Object.keys(s.avail).forEach(function (u) {
      var a = s.avail[u]; if (!u || !isObj(a)) return; var e = {}, any = false;
      Object.keys(a).forEach(function (k) { if (k === 'note') { if (typeof a.note === 'string' && a.note) { e.note = a.note; any = true; } } else if (VALS.indexOf(a[k]) >= 0) { e[k] = a[k]; any = true; } });
      if (any) out.avail[u] = e;
    });
    out.next = normNext(s.next);
    if (isObj(s.rsvp)) Object.keys(s.rsvp).forEach(function (u) { var r = s.rsvp[u]; if (u && isObj(r) && (r.v === 'in' || r.v === 'out') && ms(r.at)) out.rsvp[u] = { at: str(r.at), v: r.v }; });
    if (isObj(s.cadence)) {
      var c = s.cadence;
      out.cadence = { weeks: clamp(c.weeks, 1, 4), weekday: clamp(c.weekday, 0, 6), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ? c.time : '19:00', minutes: minutes(c.minutes) };
    }
    out.quorum = clamp(s.quorum, 0, 12);
    return out;
  }
  /* what changed from a to b: nested objects as nested patches, removed keys as null, anything else whole */
  function diff(a, b) {
    if (same(a, b)) return undefined;
    if (isObj(a) && isObj(b)) {
      var out = {}, any = false;
      Object.keys(b).forEach(function (k) { if (b[k] === undefined) return; var d = diff(a[k], b[k]); if (d !== undefined) { out[k] = d; any = true; } });
      Object.keys(a).forEach(function (k) { if ((!own(b, k) || b[k] === undefined) && a[k] != null) { out[k] = null; any = true; } });
      return any ? out : undefined;
    }
    return b == null ? (a == null ? undefined : null) : clone(b);
  }
  /* a PATCH applied locally, as the server does it: objects merge, null deletes */
  function merge(t, p) {
    Object.keys(p).forEach(function (k) { var v = p[k]; if (v === null) delete t[k]; else if (isObj(v) && isObj(t[k])) merge(t[k], v); else t[k] = clone(v); });
    return t;
  }
  /* only the player's own keys survive: schedule.avail.<me> and schedule.rsvp.<me> */
  function restrict(patch, me) {
    if (!isObj(patch) || !me) return undefined;
    var out = {}, any = false;
    ['avail', 'rsvp'].forEach(function (k) { if (isObj(patch[k]) && own(patch[k], me)) { out[k] = {}; out[k][me] = clone(patch[k][me]); any = true; } });
    return any ? out : undefined;
  }

  /* options still open: `at` no older than 12 h, soonest first */
  function openOptions(s, now) {
    now = now || Date.now();
    return Object.keys(s.options).map(function (id) { return Object.assign({ id: id }, s.options[id]); })
      .filter(function (o) { return ms(o.at) >= now - PAST; })
      .sort(function (a, b) { return ms(a.at) - ms(b.at) || (a.id < b.id ? -1 : 1); });
  }
  function pastOptions(s, now) { now = now || Date.now(); return Object.keys(s.options).filter(function (id) { return ms(s.options[id].at) < now - PAST; }); }
  /* everyone the page knows: extra ids (roster owners, me) plus everyone who answered */
  function people(s, extra) {
    var seen = {}, out = [];
    (extra || []).concat(Object.keys(s.avail), Object.keys(s.rsvp)).forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }
  /* yes / maybe counts per open option, the best (most yes, then most maybe, then soonest) and quorum */
  function tally(s, opts, known) {
    var need = s.quorum || known.length, best = null;
    var rows = opts.map(function (o) {
      var yes = 0, maybe = 0, no = 0;
      Object.keys(s.avail).forEach(function (u) { var v = s.avail[u][o.id]; if (v === 'yes') yes++; else if (v === 'maybe') maybe++; else if (v === 'no') no++; });
      return { id: o.id, yes: yes, maybe: maybe, no: no, quorum: need > 0 && yes >= need };
    });
    rows.forEach(function (r) { if ((r.yes || r.maybe) && (!best || r.yes > best.yes || (r.yes === best.yes && r.maybe > best.maybe))) best = r; });
    var by = {}; rows.forEach(function (r) { r.best = r === best; by[r.id] = r; });
    return { by: by, best: best ? best.id : null, need: need };
  }
  /* the next session is shown while it is ahead or started less than its length ago */
  function upcoming(s, now) { var n = s.next; if (!n) return null; now = now || Date.now(); return now < ms(n.at) + n.minutes * 60000 ? n : null; }
  function rsvpOf(s, id) { var r = id && s.rsvp[id], n = s.next; return r && n && ms(r.at) === ms(n.at) ? r.v : null; }
  function staleRsvp(s, id) { var r = id && s.rsvp[id], n = s.next; return !!(r && n && ms(r.at) !== ms(n.at)); }

  /* ---------- local time ---------- */
  function dayNo(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(iso) { var d = new Date(ms(iso)); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(iso) { var d = new Date(ms(iso)); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /* <input type="date"> + <input type="time"> in local time -> a UTC instant */
  function fromLocal(date, time) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''), t = /^(\d{1,2}):(\d{2})/.exec(time || '');
    if (!m || !t) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], 0, 0);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function fmt(iso, o) { var t = ms(iso); if (!t) return ''; try { return new Date(t).toLocaleString(undefined, o); } catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); } }
  function thisYear(iso) { return new Date(ms(iso)).getFullYear() === new Date().getFullYear(); }
  /* "Sat 24 Oct" (en-GB) / "Sat Oct 24" (en-US): the weekday and the date asked apart, so no locale adds a comma */
  function fmtDay(iso) { var o = { day: 'numeric', month: 'short' }; if (!thisYear(iso)) o.year = 'numeric'; return fmt(iso, { weekday: 'short' }) + ' ' + fmt(iso, o); }
  function fmtTime(iso) { return fmt(iso, { hour: 'numeric', minute: '2-digit' }); }
  function fmtWhen(iso) { return fmtDay(iso) + ', ' + fmtTime(iso); }
  function fmtLong(iso) { var o = { day: 'numeric', month: 'long' }; if (!thisYear(iso)) o.year = 'numeric'; return fmt(iso, { weekday: 'long' }) + ' ' + fmt(iso, o); }
  function weekdayName(n, style) { var d = new Date(2024, 0, 7 + n); try { return d.toLocaleDateString(undefined, { weekday: style || 'short' }); } catch (e) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]; } }
  /* "in 6 days", "tomorrow", "tonight", "in 40 min", "now" */
  function countdown(next, now) {
    now = now || Date.now(); var t = ms(next.at), end = t + next.minutes * 60000;
    if (now >= t && now < end) return 'now';
    if (now >= end) return 'over';
    var mins = (t - now) / 60000;
    if (mins < 60) return 'in ' + Math.max(1, Math.round(mins)) + ' min';
    var dn = dayNo(new Date(t)) - dayNo(new Date(now));
    if (dn <= 0) return new Date(t).getHours() >= 17 ? 'tonight' : 'today';
    if (dn === 1) return 'tomorrow';
    if (dn <= 20) return 'in ' + dn + ' days';
    return 'in ' + Math.round(dn / 7) + ' weeks';
  }

  /* ---------- the cadence: the next three dates on its weekday and time, every `weeks` weeks ---------- */
  function cadenceDates(s, now, count) {
    var c = s.cadence; if (!c) return [];
    now = now || Date.now(); count = count || 3;
    var open = openOptions(s, now), all = Object.keys(s.options).map(function (k) { return ms(s.options[k].at); }).sort(function (a, b) { return a - b; });
    var start = Math.max(now, open.length ? ms(open[open.length - 1].at) : 0);
    var anchor = s.next ? ms(s.next.at) : all.length ? all[all.length - 1] : 0;
    var hm = c.time.split(':'), d0 = new Date(start);
    var cand = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), +hm[0], +hm[1], 0, 0);
    cand.setDate(cand.getDate() + (c.weekday - cand.getDay() + 7) % 7);
    while (cand.getTime() <= start) cand.setDate(cand.getDate() + 7);
    if (anchor && c.weeks > 1) {
      /* keep the rhythm: whole multiples of `weeks` from the anchor's week (the anchor moved to the cadence weekday) */
      var a = new Date(anchor), ad = new Date(a.getFullYear(), a.getMonth(), a.getDate());
      var off = (c.weekday - ad.getDay() + 7) % 7; if (off > 3) off -= 7; ad.setDate(ad.getDate() + off);
      var period = 7 * c.weeks, g = 0;
      while ((((dayNo(cand) - dayNo(ad)) % period) + period) % period !== 0 && g++ < 8) cand.setDate(cand.getDate() + 7);
    }
    var taken = {};
    Object.keys(s.options).forEach(function (k) { taken[localDate(s.options[k].at)] = 1; });
    if (s.next) taken[localDate(s.next.at)] = 1;
    var out = [], guard = 0;
    while (out.length < count && guard++ < 200) {
      var iso = cand.toISOString();
      if (!taken[localDate(iso)]) out.push(iso);
      cand.setDate(cand.getDate() + 7 * c.weeks);
    }
    return out;
  }

  /* ---------- calendar: one VEVENT, and a Google Calendar link ---------- */
  function icsStamp(t) { return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, ''); }
  function icsText(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'); }
  function u8len(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  function fold(line) {   /* lines longer than 75 octets continue on the next line after a space */
    var out = [], cur = '', n = 0;
    Array.from(line).forEach(function (ch) { var b = u8len(ch); if (n + b > 75) { out.push(cur); cur = ' '; n = 1; } cur += ch; n += b; });
    out.push(cur); return out.join('\r\n');
  }
  function summary(crewName) { return "Blades '68 · " + (String(crewName || '').trim() || 'session'); }
  function ics(next, crewName, now) {
    var t = ms(next.at), lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blades 68//The table//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:b68-' + next.at + '@blades68',
      'DTSTAMP:' + icsStamp(now || Date.now()),
      'DTSTART:' + icsStamp(t),
      'DTEND:' + icsStamp(t + next.minutes * 60000),
      'SUMMARY:' + icsText(summary(crewName))
    ];
    if (next.place) lines.push('LOCATION:' + icsText(next.place));
    if (next.note) lines.push('DESCRIPTION:' + icsText(next.note));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  function gcal(next, crewName) {
    var t = ms(next.at);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(summary(crewName)) +
      '&dates=' + icsStamp(t) + '/' + icsStamp(t + next.minutes * 60000) +
      '&details=' + encodeURIComponent(next.note || '') + '&location=' + encodeURIComponent(next.place || '');
  }
  function icsName(next) { return 'blades68-session-' + localDate(next.at) + '.ics'; }

  /* ---------- names: one cache for the card and the table page, asked once per id through api.profiles ---------- */
  var names = {}, asked = {};
  function askNames(ids, profiles, done) {
    if (typeof profiles !== 'function') return;
    var want = (ids || []).filter(function (id) { return id && !asked[id]; }); if (!want.length) return;
    want.forEach(function (id) { asked[id] = 1; });
    Promise.resolve().then(function () { return profiles(want); }).then(function (map) {
      if (!map || typeof map !== 'object') return; var any = false;
      Object.keys(map).forEach(function (id) { var v = map[id], n = typeof v === 'string' ? v : v && (v.name || v.email) || ''; if (n && names[id] !== n) { names[id] = n; any = true; } });
      if (any && done) done();
    }).catch(function () {});
  }
  function nameOf(id, me, extra) { var n = (extra && extra[id]) || names[id]; return n || (id && id === me ? 'You' : 'Someone'); }

  M.defaults = defaults; M.normalize = normalize; M.diff = diff; M.merge = merge; M.restrict = restrict;
  M.openOptions = openOptions; M.pastOptions = pastOptions; M.people = people; M.tally = tally; M.upcoming = upcoming;
  M.rsvpOf = rsvpOf; M.cadenceDates = cadenceDates; M.countdown = countdown; M.fromLocal = fromLocal;
  M.ics = ics; M.gcal = gcal; M.fmtWhen = fmtWhen; M.fmtDay = fmtDay; M.names = names; M.askNames = askNames;

  /* ---------- people, in order: me first, then by name ---------- */
  function ordered(ids, me, nm) {
    return ids.slice().sort(function (a, b) {
      if (me && (a === me) !== (b === me)) return a === me ? -1 : 1;
      var x = nm(a).toLowerCase(), y = nm(b).toLowerCase(); return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
    });
  }
  /* who is in / out / not answered for the next session */
  function rsvpLists(s, known, nm) {
    var r = { in: [], out: [], none: [] };
    known.forEach(function (id) { var v = rsvpOf(s, id); (v === 'in' ? r.in : v === 'out' ? r.out : r.none).push(id); });
    return r;
  }
  function namesList(ids, nm, me) { return '<span class="sc-names">' + ids.map(function (id) { return '<span class="sc-nm' + (id === me ? ' me' : '') + '">' + esc(nm(id)) + '</span>'; }).join(', ') + '</span>'; }

  /* ================= the schedule box on the table page ================= */
  /* ctx (campaign.js): { sched, me, isGM, ro, drafts, people (ids), name(id), commit(), render(), confirm(msg),
                         logLine(text), status(msg, bad), focus(sel), esc, box, chip } */
  function lengthSelect(ui, value, label) {
    return '<select class="sc-sel" data-ui="' + ui + '" data-gm="1" aria-label="' + esc(label) + '">' + LENGTHS.concat(LENGTHS.indexOf(value) < 0 ? [value] : []).sort(function (a, b) { return a - b; }).map(function (m) { return '<option value="' + m + '"' + (m === value ? ' selected' : '') + '>' + lenLabel(m) + '</option>'; }).join('') + '</select>';
  }
  function draft(ctx, k, dflt) { var v = ctx.drafts[k]; return v == null ? dflt : v; }
  function nextSection(s, ctx, known) {
    var n = s.next, h = '', editing = ctx.isGM && (!n || ctx.drafts['sched.editing']);
    if (n) {
      var t = ms(n.at), live = upcoming(s), cd = live ? countdown(n) : 'over', lists = rsvpLists(s, known, ctx.name), d = new Date(t);
      h += '<div class="sc-next' + (live ? '' : ' past') + '">' +
        '<div class="sc-leaf" aria-hidden="true"><span class="sc-leafm">' + esc(fmt(n.at, { month: 'short' })) + '</span><b>' + d.getDate() + '</b><span class="sc-leafw">' + esc(fmt(n.at, { weekday: 'short' })) + '</span></div>' +
        '<div class="sc-nextinfo"><div class="sc-nextwhen"><b>' + esc(fmtLong(n.at)) + '</b><span class="mono">' + esc(fmtTime(n.at) + '–' + fmtTime(new Date(t + n.minutes * 60000).toISOString())) + ' · ' + lenLabel(n.minutes) + '</span>' +
        '<span class="sc-cd' + (cd === 'now' ? ' now' : '') + '">' + esc(cd === 'over' ? 'over' : cd) + '</span></div>' +
        (n.place ? '<div class="sc-place"><span class="tp-k">Where</span> ' + esc(n.place) + '</div>' : '') +
        (n.note ? '<div class="sc-note">' + esc(n.note) + '</div>' : '') +
        '<div class="sc-rsvp"><span class="sc-tag in">' + lists.in.length + ' in</span>' + (lists.in.length ? namesList(lists.in, ctx.name, ctx.me) : '<span class="tp-dim">nobody yet</span>') +
        (lists.out.length ? '<span class="sc-tag out">' + lists.out.length + ' out</span>' + namesList(lists.out, ctx.name, ctx.me) : '') +
        (lists.none.length ? '<span class="sc-tag none">' + lists.none.length + ' no answer</span>' + namesList(lists.none, ctx.name, ctx.me) : '') + '</div>' +
        '</div>' +
        (ctx.isGM && !editing ? '<div class="sc-nextbtns"><button type="button" class="btn sm" data-act="sched.nextedit" data-gm="1">Change</button><button type="button" class="btn sm" data-act="sched.nextclear" data-gm="1">Clear</button></div>' : '') +
        '</div>';
      if (!ctx.isGM && !ctx.ro && ctx.me) h += '<p class="hint">Say whether you are in from the bar at the top of the page.</p>';
    } else if (!ctx.isGM) h += '<p class="hint sc-none">No session is set yet.' + (ctx.ro || !ctx.me ? '' : ' Mark the dates you can make below; the GM confirms one.') + '</p>';
    if (editing) {
      var nd = n || {}, cad = s.cadence;
      h += '<div class="sc-form" role="group" aria-label="' + (n ? 'Change the next session' : 'Set the next session') + '">' +
        '<span class="tp-lab">' + (n ? 'Change the next session' : 'Set the next session') + '</span>' +
        '<div class="sc-row"><input type="date" class="tp-in sc-date" data-ui="sched.ndate" data-gm="1" aria-label="Date" value="' + esc(draft(ctx, 'sched.ndate', n ? localDate(n.at) : '')) + '">' +
        '<input type="time" class="tp-in sc-time" data-ui="sched.ntime" data-gm="1" aria-label="Start time" value="' + esc(draft(ctx, 'sched.ntime', n ? localTime(n.at) : cad ? cad.time : '19:00')) + '">' +
        lengthSelect('sched.nlen', +draft(ctx, 'sched.nlen', nd.minutes || (cad ? cad.minutes : 240)), 'Length') + '</div>' +
        '<div class="sc-row"><input type="text" class="tp-in sc-grow" data-ui="sched.nplace" data-gm="1" aria-label="Place" placeholder="Where (a home, a café, a call link)" value="' + esc(draft(ctx, 'sched.nplace', nd.place || '')) + '">' +
        '<input type="text" class="tp-in sc-grow" data-ui="sched.nnote" data-gm="1" aria-label="Note" placeholder="A note (bring snacks, the heist plan…)" value="' + esc(draft(ctx, 'sched.nnote', nd.note || '')) + '"></div>' +
        '<div class="sc-row"><button type="button" class="btn sm primary" data-act="sched.nextset" data-gm="1">' + (n ? 'Save' : 'Set the next session') + '</button>' +
        (n ? '<button type="button" class="btn sm" data-act="sched.nextcancel" data-gm="1">Cancel</button>' : '') + '</div></div>';
    }
    return h;
  }
  function cellGlyph(v) { return v === 'yes' ? '✓' : v === 'maybe' ? '?' : v === 'no' ? '✕' : ''; }
  function grid(s, ctx, known, opts, tl) {
    if (!opts.length) return '<p class="hint sc-empty">' + (ctx.isGM ? 'No dates proposed. Add a date below, or set a cadence and add the next three.' : 'No dates proposed yet. The GM adds them here.') + '</p>';
    var dayCount = {}; opts.forEach(function (o) { var k = localDate(o.at); dayCount[k] = (dayCount[k] || 0) + 1; });
    function optLabel(o) { return fmtDay(o.at) + (dayCount[localDate(o.at)] > 1 ? ' ' + fmtTime(o.at) : ''); }
    var now = Date.now();
    var h = '<div class="sc-scroll" tabindex="0" role="region" aria-label="Availability"><table class="sc-grid"><thead><tr><th class="sc-who" scope="col"><span class="tp-lab">Who</span></th>';
    opts.forEach(function (o) {
      var r = tl.by[o.id], gone = ms(o.at) < now;
      h += '<th scope="col" class="sc-opt' + (r.best ? ' best' : '') + (r.quorum ? ' quorum' : '') + (gone ? ' gone' : '') + '" data-o="' + esc(o.id) + '"><span class="sc-wd">' + esc(fmt(o.at, { weekday: 'short' })) + '</span><span class="sc-dm">' + esc(fmt(o.at, { day: 'numeric', month: 'short' })) + '</span><span class="sc-tm mono">' + esc(fmtTime(o.at)) + '</span>' +
        (o.note ? '<span class="sc-onote" title="' + esc(o.note) + '">' + esc(o.note) + '</span>' : '') +
        (ctx.isGM ? '<button type="button" class="tp-x sc-rm" data-act="sched.optrm" data-o="' + esc(o.id) + '" data-gm="1" title="Remove this date" aria-label="Remove ' + esc(optLabel(o)) + '">×</button>' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    known.forEach(function (id) {
      var mine = id === ctx.me, a = s.avail[id] || {}, nm = ctx.name(id);
      h += '<tr' + (mine ? ' class="me"' : '') + '><th scope="row" class="sc-who"><span class="sc-whon"><b>' + esc(nm) + '</b>' + (mine && nm !== 'You' ? '<span class="tp-you">you</span>' : '') + '</span>' + (a.note ? '<small class="sc-pnote">' + esc(a.note) + '</small>' : '') + '</th>';
      opts.forEach(function (o) {
        var v = a[o.id] || '', r = tl.by[o.id];
        h += '<td class="' + (r.best ? 'best' : '') + '"><button type="button" class="sc-cell v-' + (v || 'none') + '"' + ' data-o="' + esc(o.id) + '"' + (mine ? ' data-act="sched.cycle"' : ' disabled data-other="1"') +
          ' aria-label="' + esc(nm + ': ' + optLabel(o) + ', ' + (v || 'no answer')) + '"' + (mine ? ' title="Tap to change: yes, maybe, no, blank"' : '') + '><span aria-hidden="true">' + cellGlyph(v) + '</span></button></td>';
      });
      h += '</tr>';
    });
    h += '</tbody><tfoot><tr><th class="sc-who" scope="row"><span class="tp-lab">Yes <span class="sc-mb">+ maybe</span></span></th>';
    opts.forEach(function (o) {
      var r = tl.by[o.id];
      h += '<td class="' + (r.best ? 'best' : '') + '"><span class="sc-count mono"><b>' + r.yes + '</b>' + (r.maybe ? '<small>+' + r.maybe + '</small>' : '') + '</span>' +
        (r.best ? '<span class="sc-flag best">Best</span>' : '') + (r.quorum ? '<span class="sc-flag q">Quorum</span>' : '') +
        (ctx.isGM ? '<button type="button" class="chip sm sc-confirm" data-act="sched.confirm" data-o="' + esc(o.id) + '" data-gm="1" aria-label="Confirm ' + esc(optLabel(o)) + '">Confirm</button>' : '') + '</td>';
    });
    h += '</tr></tfoot></table></div>';
    return h;
  }
  function gmTools(s, ctx, now) {
    var cad = s.cadence, past = pastOptions(s, now).length, known = ctx.people.length;
    var h = '<div class="tp-sub sc-tools"><span class="tp-lab">Propose a date</span><div class="sc-row">' +
      '<input type="date" class="tp-in sc-date" data-ui="sched.odate" data-gm="1" aria-label="Date to propose" value="' + esc(draft(ctx, 'sched.odate', '')) + '">' +
      '<input type="time" class="tp-in sc-time" data-ui="sched.otime" data-gm="1" aria-label="Start time" value="' + esc(draft(ctx, 'sched.otime', cad ? cad.time : '19:00')) + '">' +
      lengthSelect('sched.olen', +draft(ctx, 'sched.olen', cad ? cad.minutes : 240), 'Length') +
      '<button type="button" class="btn sm" data-act="sched.optadd" data-gm="1">Add date</button></div></div>';
    h += '<div class="tp-sub sc-tools"><span class="tp-lab">Cadence</span><div class="sc-cad">' +
      '<span class="sc-k">Every</span><span class="seg">' + [1, 2, 3, 4].map(function (w) { return ctx.chip(String(w), 'sched.cadweeks', !!cad && cad.weeks === w, ' data-n="' + w + '"', { gm: true, title: w === 1 ? 'Every week' : 'Every ' + w + ' weeks' }); }).join('') + '</span><span class="sc-k">' + (cad && cad.weeks > 1 ? 'weeks' : 'week') + ' on</span>' +
      '<span class="seg sc-days">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return ctx.chip(esc(weekdayName(d, 'short')), 'sched.cadday', !!cad && cad.weekday === d, ' data-n="' + d + '" aria-label="' + esc(weekdayName(d, 'long')) + '"', { gm: true, title: weekdayName(d, 'long') }); }).join('') + '</span>' +
      '<span class="sc-k">at</span><input type="time" class="tp-in sc-time" data-ui="sched.cadtime" data-gm="1" aria-label="Cadence start time" value="' + esc(cad ? cad.time : draft(ctx, 'sched.cadtime', '19:00')) + '">' +
      lengthSelect('sched.cadlen', cad ? cad.minutes : 240, 'Cadence length') + '</div>' +
      '<div class="sc-row"><button type="button" class="btn sm" data-act="sched.cad3" data-gm="1"' + (cad ? '' : ' disabled title="Pick a weekday first"') + '>Add the next three</button>' +
      (cad ? '<span class="tp-dim">' + esc(cadenceDates(s, now, 3).map(fmtDay).join(' · ')) + '</span>' : '<span class="tp-dim">Pick how often and which day.</span>') + '</div></div>';
    h += '<div class="tp-sub sc-tools sc-qrow"><span class="tp-lab">Quorum</span><div class="sc-row"><span class="seg">' +
      ctx.chip('−', 'sched.quorum', null, ' data-n="-1" aria-label="Fewer"', { gm: true }) + '<span class="sc-qv mono" aria-live="polite">' + (s.quorum ? s.quorum + ' yes' : 'everyone (' + known + ')') + '</span>' +
      ctx.chip('+', 'sched.quorum', null, ' data-n="1" aria-label="More"', { gm: true }) + '</span><span class="tp-dim">yes answers that make a date workable</span>' +
      (past ? '<button type="button" class="btn sm sc-clearpast" data-act="sched.clearpast" data-gm="1">Clear past dates (' + past + ')</button>' : '') + '</div></div>';
    return h;
  }
  M.box = function (doc, ctx) {
    var s = doc.schedule, now = Date.now(), known = ordered(ctx.people, ctx.me, ctx.name), opts = openOptions(s, now), tl = tally(s, opts, known);
    var h = nextSection(s, ctx, known);
    h += '<div class="sc-avail"><div class="tp-subh"><span class="tp-lab">Who can make it</span>' + (opts.length ? '<span class="tp-dim">' + (ctx.me && !ctx.ro ? 'tap your row: yes, maybe, no' : '') + '</span>' : '') + '</div>' + grid(s, ctx, known, opts, tl) + '</div>';
    if (ctx.me && !ctx.ro && opts.length) {
      var mine = (s.avail[ctx.me] || {}).note || '';
      h += '<div class="sc-mynote"><label class="sc-row"><span class="tp-lab">Your note</span><input type="text" class="tp-in sc-grow" data-ui="sched.note" aria-label="Your availability note" placeholder="Away the week of the 20th…" value="' + esc(draft(ctx, 'sched.note', mine)) + '"></label></div>';
    }
    if (ctx.isGM) h += gmTools(s, ctx, now);
    var right = (s.next && upcoming(s, now) ? 'next ' + fmtDay(s.next.at) + ' · ' : '') + opts.length + ' date' + (opts.length === 1 ? '' : 's') + ' open';
    return ctx.box('Schedule', h, '<span class="tp-dim">' + esc(right) + '</span>', 'tp-schedbox');
  };

  /* ---------- actions ---------- */
  function dropOptions(s, ids) { ids.forEach(function (id) { delete s.options[id]; Object.keys(s.avail).forEach(function (u) { if (s.avail[u] && own(s.avail[u], id)) delete s.avail[u][id]; }); }); }
  function clearDrafts(ctx, keys) { keys.forEach(function (k) { delete ctx.drafts[k]; }); }
  var NEXT_DRAFTS = ['sched.editing', 'sched.ndate', 'sched.ntime', 'sched.nlen', 'sched.nplace', 'sched.nnote'];
  M.PERM = { cycle: 'any', note: 'any', optadd: 'gm', optrm: 'gm', confirm: 'gm', cad3: 'gm', cadweeks: 'gm', cadday: 'gm', cadtime: 'gm', cadlen: 'gm', quorum: 'gm', clearpast: 'gm', nextedit: 'gm', nextcancel: 'gm', nextset: 'gm', nextclear: 'gm' };
  M.ENTER = { 'sched.note': 'note' };
  M.CHANGE = { 'sched.note': 'note', 'sched.cadtime': 'cadtime', 'sched.cadlen': 'cadlen' };
  function setCadence(s, f) { var c = s.cadence || { weeks: 1, weekday: 6, time: '19:00', minutes: 240 }; s.cadence = Object.assign({}, c, f); }
  M.acts = {
    cycle: function (d, ctx) {
      var s = ctx.sched, me = ctx.me; if (!me || !s.options[d.o]) return;
      var a = s.avail[me] = s.avail[me] || {}, v = CYCLE[a[d.o] || ''];
      if (v) a[d.o] = v; else delete a[d.o];
      if (!Object.keys(a).length) delete s.avail[me];
      ctx.commit();
    },
    note: function (d, ctx) {
      var s = ctx.sched, me = ctx.me; if (!me) return;
      var v = String(ctx.drafts['sched.note'] == null ? '' : ctx.drafts['sched.note']).trim().slice(0, 200), a = s.avail[me] || {};
      delete ctx.drafts['sched.note'];
      if ((a.note || '') === v) return;
      if (v) { a.note = v; s.avail[me] = a; } else { delete a.note; if (Object.keys(a).length) s.avail[me] = a; else delete s.avail[me]; }
      ctx.commit();
    },
    optadd: function (d, ctx) {
      var s = ctx.sched, at = fromLocal(ctx.drafts['sched.odate'], draft(ctx, 'sched.otime', s.cadence ? s.cadence.time : '19:00'));
      if (!at) { ctx.status('Pick a date (and a time) first', true, true); ctx.focus('[data-ui="sched.odate"]'); return; }
      if (Object.keys(s.options).some(function (k) { return ms(s.options[k].at) === ms(at); })) { ctx.status('That date is already proposed', true, true); return; }
      if (ms(at) < Date.now() - PAST) { ctx.status('That date is in the past', true, true); return; }
      s.options[newOptionId()] = { at: at, minutes: minutes(draft(ctx, 'sched.olen', s.cadence ? s.cadence.minutes : 240)), note: '' };
      delete ctx.drafts['sched.odate'];
      ctx.commit();
    },
    optrm: function (d, ctx) {
      var s = ctx.sched, o = s.options[d.o]; if (!o) return;
      var answered = Object.keys(s.avail).some(function (u) { return own(s.avail[u], d.o); });
      if (answered && !ctx.confirm('Remove ' + fmtWhen(o.at) + '? The answers for it go too.')) return;
      dropOptions(s, [d.o]); ctx.commit();
    },
    confirm: function (d, ctx) {
      var s = ctx.sched, o = s.options[d.o]; if (!o) return;
      var t = ms(o.at), earlier = Object.keys(s.options).filter(function (k) { return ms(s.options[k].at) <= t; });
      if (!ctx.confirm('Confirm ' + fmtWhen(o.at) + ' as the next session?' + (earlier.length > 1 ? ' The ' + (earlier.length - 1) + ' earlier date' + (earlier.length > 2 ? 's go' : ' goes') + ' from the grid.' : ''))) return;
      s.next = { at: o.at, minutes: o.minutes, place: s.next ? s.next.place : '', note: o.note || '', confirmedAt: new Date().toISOString() };
      dropOptions(s, earlier); clearDrafts(ctx, NEXT_DRAFTS);
      ctx.logLine('Next session: ' + fmtWhen(o.at)); ctx.commit();
    },
    cad3: function (d, ctx) {
      var s = ctx.sched; if (!s.cadence) return;
      var list = cadenceDates(s, Date.now(), 3); if (!list.length) return;
      list.forEach(function (at) { s.options[newOptionId()] = { at: at, minutes: s.cadence.minutes, note: '' }; });
      ctx.commit();
    },
    cadweeks: function (d, ctx) { var n = clamp(d.n, 1, 4); if (ctx.sched.cadence && ctx.sched.cadence.weeks === n) return; setCadence(ctx.sched, { weeks: n }); ctx.commit(); },
    cadday: function (d, ctx) { var n = clamp(d.n, 0, 6); if (ctx.sched.cadence && ctx.sched.cadence.weekday === n) return; setCadence(ctx.sched, { weekday: n, time: ctx.sched.cadence ? ctx.sched.cadence.time : draft(ctx, 'sched.cadtime', '19:00') }); ctx.commit(); },
    cadtime: function (d, ctx) {
      var v = String(ctx.drafts['sched.cadtime'] || ''); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return;
      if (!ctx.sched.cadence) { ctx.render(); return; }   /* kept as a draft until a weekday is picked */
      if (ctx.sched.cadence.time === v) return; setCadence(ctx.sched, { time: v }); delete ctx.drafts['sched.cadtime']; ctx.commit();
    },
    cadlen: function (d, ctx) { var v = minutes(ctx.drafts['sched.cadlen']); delete ctx.drafts['sched.cadlen']; if (ctx.sched.cadence && ctx.sched.cadence.minutes === v) return; setCadence(ctx.sched, { minutes: v }); ctx.commit(); },
    quorum: function (d, ctx) { var q = clamp(ctx.sched.quorum + (+d.n || 0), 0, 12); if (q === ctx.sched.quorum) return; ctx.sched.quorum = q; ctx.commit(); },
    clearpast: function (d, ctx) { var ids = pastOptions(ctx.sched); if (!ids.length) return; dropOptions(ctx.sched, ids); ctx.commit(); },
    nextedit: function (d, ctx) { clearDrafts(ctx, NEXT_DRAFTS); ctx.drafts['sched.editing'] = true; ctx.render(); ctx.focus('[data-ui="sched.ndate"]'); },
    nextcancel: function (d, ctx) { clearDrafts(ctx, NEXT_DRAFTS); ctx.render(); },
    nextset: function (d, ctx) {
      var s = ctx.sched, n = s.next, cad = s.cadence;
      var at = fromLocal(draft(ctx, 'sched.ndate', n ? localDate(n.at) : ''), draft(ctx, 'sched.ntime', n ? localTime(n.at) : cad ? cad.time : '19:00'));
      if (!at) { ctx.status('Pick a date (and a time) first', true, true); ctx.focus('[data-ui="sched.ndate"]'); return; }
      var nn = { at: n && ms(n.at) === ms(at) ? n.at : at, minutes: minutes(draft(ctx, 'sched.nlen', n ? n.minutes : cad ? cad.minutes : 240)), place: String(draft(ctx, 'sched.nplace', n ? n.place : '')).trim(), note: String(draft(ctx, 'sched.nnote', n ? n.note : '')).trim(), confirmedAt: new Date().toISOString() };
      var moved = !n || ms(n.at) !== ms(at);
      if (n && !moved) nn.confirmedAt = n.confirmedAt || nn.confirmedAt;
      clearDrafts(ctx, NEXT_DRAFTS);
      if (n && same(nn, n)) { ctx.render(); return; }
      s.next = nn;
      if (moved) ctx.logLine((n ? 'Next session moved to ' : 'Next session: ') + fmtWhen(at));
      ctx.commit();
    },
    nextclear: function (d, ctx) {
      var s = ctx.sched; if (!s.next) return;
      if (!ctx.confirm('Clear the next session (' + fmtWhen(s.next.at) + ')? Everyone’s answers for it go too.')) return;
      s.next = null; s.rsvp = {}; clearDrafts(ctx, NEXT_DRAFTS); ctx.commit();
    }
  };
  /* Starting a session (the session bar): `next` goes when it is within 12 h of now, and the dates that are not
     clearly ahead (before now + 12 h) leave the grid, in the same write as the session itself. */
  M.onSessionStart = function (s, now) {
    now = now || Date.now();
    if (s.next && Math.abs(ms(s.next.at) - now) <= PAST) { s.next = null; s.rsvp = {}; }
    dropOptions(s, Object.keys(s.options).filter(function (k) { return ms(s.options[k].at) < now + PAST; }));
  };

  /* ================= the next-session card (#nextSession), every mode ================= */
  /* api (boot.js): { me(), canWrite(), save(patch) -> Promise, saveFile(name, text), people() -> ids, profiles(ids) | null } */
  var card = { el: null, api: null, s: null, crew: '', open: null, timer: null, err: '', html: '' };
  function cardOpenDefault() {
    try { var v = localStorage.getItem('b68.nextOpen'); if (v === '1' || v === '0') return v === '1'; } catch (e) {}
    return !(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  }
  function cardRender() {
    var el = card.el; if (!el) return;
    var s = card.s, n = s && upcoming(s);
    if (!n) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; } card.html = ''; stopTick(); return; }
    if (card.open == null) card.open = cardOpenDefault();
    var api = card.api || {}, me = api.me ? api.me() : null, ro = api.canWrite ? api.canWrite() === false : false;
    var known = ordered(people(s, (api.people ? api.people() : []).concat(me ? [me] : [])), me, function (id) { return nameOf(id, me); });
    var nm = function (id) { return nameOf(id, me); };
    askNames(known, api.profiles, cardRender);
    var lists = rsvpLists(s, known, nm), mine = rsvpOf(s, me), stale = staleRsvp(s, me), cd = countdown(n);
    var end = new Date(ms(n.at) + n.minutes * 60000).toISOString();
    var mineTxt = mine === 'in' ? ['You’re in', 'In'] : mine === 'out' ? ['You’re out', 'Out'] : me && !ro ? ['Are you in?', 'RSVP'] : null;
    var h = '<button type="button" class="nx-line" data-nx="toggle" aria-expanded="' + card.open + '" aria-controls="nx-more">' +
      '<span class="nx-kick">Next<span class="nx-long"> session</span></span>' +
      '<span class="nx-when"><b>' + esc(fmtDay(n.at)) + '</b> <span class="nx-time">' + esc(fmtTime(n.at)) + '</span></span>' +
      '<span class="nx-cd' + (cd === 'now' ? ' now' : '') + '">' + esc(cd) + '</span><span class="nx-gap"></span>' +
      '<span class="nx-tally">' + lists.in.length + ' in' + (lists.out.length ? ' · ' + lists.out.length + ' out' : '') + '</span>' +
      (mineTxt ? '<span class="nx-mine ' + (mine || 'ask') + '"><span class="nx-long">' + esc(mineTxt[0]) + '</span><span class="nx-short">' + esc(mineTxt[1]) + '</span></span>' : '') +
      '<span class="nx-caret" aria-hidden="true"></span><span class="nx-sr">' + (card.open ? 'Hide' : 'Show') + ' details</span></button>';
    h += '<div class="nx-more" id="nx-more"' + (card.open ? '' : ' hidden') + '>' +
      '<div class="nx-info"><div class="nx-full"><b>' + esc(fmtLong(n.at)) + '</b> <span class="mono">' + esc(fmtTime(n.at) + '–' + fmtTime(end)) + '</span></div>' +
      (n.place ? '<div class="nx-place"><span class="nx-k">Where</span> ' + esc(n.place) + '</div>' : '') +
      (n.note ? '<div class="nx-note">' + esc(n.note) + '</div>' : '') +
      '<div class="nx-who"><span class="nx-k in">In</span> ' + (lists.in.length ? esc(lists.in.map(nm).join(', ')) : '<span class="nx-dim">nobody yet</span>') +
      (lists.out.length ? ' <span class="nx-k out">Can’t</span> ' + esc(lists.out.map(nm).join(', ')) : '') +
      (lists.none.length ? ' <span class="nx-k">No answer</span> <span class="nx-dim">' + esc(lists.none.map(nm).join(', ')) + '</span>' : '') + '</div>' +
      (stale ? '<div class="nx-stale">The GM moved the session since you answered. Answer again.</div>' : '') +
      (card.err ? '<div class="nx-err" role="alert">' + esc(card.err) + '</div>' : '') + '</div>' +
      '<div class="nx-acts"><span class="seg nx-rsvp" role="group" aria-label="Your answer">' +
      '<button type="button" class="chip nx-in" data-nx="in" aria-pressed="' + (mine === 'in') + '"' + (!me || ro ? ' disabled' : '') + '>I’m in</button>' +
      '<button type="button" class="chip nx-out" data-nx="out" aria-pressed="' + (mine === 'out') + '"' + (!me || ro ? ' disabled' : '') + '>Can’t make it</button></span>' +
      '<span class="nx-cal"><button type="button" class="btn sm" data-nx="ics" title="Download an .ics file for your calendar app">Add to calendar</button>' +
      '<a class="btn sm" href="' + esc(gcal(n, card.crew)) + '" target="_blank" rel="noopener" data-nx="gcal">Google Calendar</a></span></div></div>';
    startTick();
    if (h === card.html && !el.hidden) return;   /* the minute tick changed nothing: keep the DOM (and the focus) */
    var a = document.activeElement, keep = a && el.contains(a) ? a.getAttribute('data-nx') : null;
    card.html = h; el.innerHTML = h; el.hidden = false;
    el.classList.toggle('open', !!card.open);
    if (keep) { var b = el.querySelector('[data-nx="' + keep + '"]'); if (b && !b.disabled) try { b.focus({ preventScroll: true }); } catch (e) {} }
  }
  function startTick() { if (!card.timer) card.timer = setInterval(cardRender, 30000); }
  function stopTick() { if (card.timer) { clearInterval(card.timer); card.timer = null; } }
  function cardClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-nx]') : null; if (!t || !card.el.contains(t) || t.disabled) return;
    var what = t.getAttribute('data-nx'), s = card.s, n = s && s.next, api = card.api || {};
    if (what === 'toggle') { card.open = !card.open; try { localStorage.setItem('b68.nextOpen', card.open ? '1' : '0'); } catch (e2) {} cardRender(); return; }
    if (!n) return;
    if (what === 'ics') { if (api.saveFile) api.saveFile(icsName(n), ics(n, card.crew)); return; }
    if (what === 'in' || what === 'out') {
      var me = api.me && api.me(); if (!me || (api.canWrite && api.canWrite() === false) || typeof api.save !== 'function') return;
      var cur = rsvpOf(s, me), val = cur === what ? null : { at: n.at, v: what }, patch = { schedule: { rsvp: {} } };
      patch.schedule.rsvp[me] = val;
      if (val) s.rsvp[me] = val; else delete s.rsvp[me];   /* optimistic; the snapshot follows */
      card.err = ''; cardRender();
      Promise.resolve().then(function () { return api.save(patch); }).catch(function (err) { card.err = 'Could not save your answer: ' + (err && err.message || err); cardRender(); });
    }
  }
  M.card = {
    mount: function (el, api) {
      if (!el) return; if (card.el && card.el !== el) card.el.removeEventListener('click', cardClick);
      card.el = el; card.api = api || {}; el.addEventListener('click', cardClick); cardRender();
    },
    /* a campaign snapshot (null: no document) */
    update: function (doc) { var d = isObj(doc) ? doc : {}; card.s = normalize(d.schedule); card.crew = isObj(d.crew) ? str(d.crew.name) : ''; cardRender(); },
    refresh: function () { cardRender(); },
    isShown: function () { return !!(card.el && !card.el.hidden); }
  };
})();
