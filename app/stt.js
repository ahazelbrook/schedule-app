/* stt.js — the table iPad's transcriber (GM.md "Listening"). The iPad sits in the middle of the table, so it hears everyone.
   The GM presses Start listening on the GM page (GET/PATCH /api/gm/stt: want on); the iPad's display shows a button, and
   one tap (iPad Safari only opens the mic on a tap) starts it. What the GM wants (want, and the session to stamp) comes with
   the display page's own poll: `stt: { seq, want, session }` in GET /api/gm/display, handed over with feed() below, so this
   module makes no request of its own for it. Only while the display answers carry no such part (an older server) does it ask
   GET /api/gm/stt every 4 s itself, as it used to. The mic goes to Deepgram's live API as 16 kHz 16-bit PCM
   (the same on iPad Safari and Chrome, whose recorders make different containers) over a WebSocket opened with a
   short-lived token from POST /api/gm/stt/token: the Deepgram key never reaches the iPad. Deepgram's finished words are
   cut into runs by speaker and merged into lines the way the vault's own transcriber does (same speaker within 4 s of
   audio: one line; a line closes after 4 s quiet or 20 s open), then posted to POST /api/gm/transcript every 3 s, each
   with its own id so a resend after a dropped answer is harmless. A dropped connection reconnects with a fresh token and
   files a "reconnected" mark (Deepgram renumbers speakers on every connection). The GM's Stop, leaving the display, or
   6 hours stops it. While it listens, a small "Listening" mark shows on the iPad. Nothing is kept on the iPad but the
   unsent lines, in memory. It reports its state to PATCH /api/gm/stt when the state changes, every 10 s while the mic is
   open, and once a minute otherwise while the page is visible (the GM page shows "N s ago" from it).
   Plain script, UMD: window.B68Stt in the browser, module.exports (the pure helpers) under Node.

   B68Stt.attach(container, { gm })   gm = window.claude.gm (stt, patchStt, sttToken, addTranscript) -> { destroy, state, feed }
     feed(part)  the display poll's transcriber part { want, session } (null: that answer had none, ask GET /api/gm/stt yourself)
   Pure: downsample(f32, inRate, outRate) -> Int16Array · runsOf(words) -> runs with their words · makeMerger(emit, clock, cue) · lineId() · DG_URL
   makeMerger(emit, clock, cue): cue is B68Cue (display bundle: cue.js loads first). A line closes after 4 s quiet or 20 s open, as before; a line holding a cue closes
   1 s after its last run (any speaker label joins it inside that second), is cut at the cue by Deepgram's words, and is emitted with cue: true; a bare
   "Blade," waits 2 s of audio for the command; the line after a cued line is emitted at once. emit gets { speaker, text, at, conn, cue?, urgent? }. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68Stt = api;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var DG_PARAMS = ['model=nova-3', 'language=en', 'diarize=true', 'smart_format=true', 'punctuate=true', 'interim_results=false',
    'endpointing=300', 'keyterm=Blade', 'encoding=linear16', 'sample_rate=16000', 'channels=1'];
  var DG_URL = 'wss://api.deepgram.com/v1/listen?' + DG_PARAMS.join('&');
  var RATE = 16000;
  /* poll: the fallback's own GET (only while the display answers carry no transcriber part). status: how often the iPad's report is
     considered while the mic is open (the GM page calls it stale after 40 s); idleStatus: the report that says "still here" when it
     is not listening and the page is visible (a change of state is always reported at once); a hidden page reports nothing. */
  var T = { poll: 4000, flush: 3000, status: 10000, idleStatus: 60000, keepalive: 4000, tick: 250, stopGrace: 3000, maxSession: 6 * 3600 * 1000 };
  /* the cue (design "the cue and the phones" 1.2, 1.4): a line holding a cue takes any run within CUE_TAIL_MS of the last, then goes;
     a line ending in a bare wake word waits ARM_S seconds of audio for the command, whatever the speaker label; the line after a cued line goes at once */
  var CUE_TAIL_MS = 1000, ARM_S = 2, AFTER_CUE_MS = 20000;
  var MERGE_GAP_S = 4, IDLE_CLOSE_MS = 4000, MAX_OPEN_MS = 20000, MAX_LINE = 700, MAX_QUEUE = 3000, MAX_BUFFER = 240, BATCH = 50;
  var BACKOFF = [1000, 2000, 5000, 10000];
  var SCHEMES = ['bearer', 'token'];          /* how the token rides the WebSocket handshake: Deepgram's subprotocol pair */
  var SCHEME_KEY = 'b68.stt.scheme';           /* which one worked last time (not a secret) */

  /* ---------- pure ---------- */
  /* Float32 samples at inRate -> 16-bit PCM at outRate (averaging each output sample's span) */
  function downsample(input, inRate, outRate) {
    var ratio = inRate / outRate, n = Math.floor(input.length / ratio), out = new Int16Array(n), pos = 0;
    for (var i = 0; i < n; i++) {
      var end = Math.min(input.length, Math.round((i + 1) * ratio)), sum = 0, c = 0;
      for (var j = Math.round(pos); j < end; j++) { sum += input[j]; c++; }
      pos = end;
      var v = c ? sum / c : 0; v = v < -1 ? -1 : v > 1 ? 1 : v;
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  }
  /* Deepgram's words -> runs of consecutive words by one speaker: [{ speaker, text, start, end }] */
  function runsOf(words, fallback) {
    var runs = [], cur = null;
    (words || []).forEach(function (w) {
      var t = String(w.punctuated_word || w.word || '').trim(); if (!t) return;
      var sp = typeof w.speaker === 'number' ? w.speaker : null;
      var ws = +w.start || 0, we = +w.end || 0;
      if (!cur || cur.speaker !== sp) { cur = { speaker: sp, parts: [t], words: [], start: ws, end: we }; runs.push(cur); }
      else { cur.parts.push(t); cur.end = +w.end || cur.end; }
      cur.words.push({ t: t, start: ws, end: we });
    });
    if (!runs.length && fallback) return [{ speaker: null, text: String(fallback).trim(), start: 0, end: 0 }];
    return runs.map(function (r) { return { speaker: r.speaker, text: r.parts.join(' '), start: r.start, end: r.end, words: r.words }; });
  }
  var idn = 0;
  function lineId() { idn = (idn + 1) % 1679616; return 'l' + Date.now().toString(36) + idn.toString(36) + Math.floor(Math.random() * 46656).toString(36); }
  /* a run's words, each with its own speaker label and its own wall time (at is the run's start): [{ t, start, end, speaker, at }].
     A run without words (a fallback transcript, a test) is cut at its spaces, the times spread evenly. */
  function wordsOf(run, at) {
    var list = run.words && run.words.length ? run.words : null;
    if (!list) {
      var parts = String(run.text || '').split(/\s+/).filter(Boolean), span = ((+run.end || 0) - (+run.start || 0)) / (parts.length || 1);
      list = parts.map(function (p, i) { return { t: p, start: (+run.start || 0) + i * span, end: (+run.start || 0) + (i + 1) * span }; });
    }
    return list.map(function (w) { return { t: w.t, start: w.start, end: w.end, speaker: run.speaker, at: (+at || 0) + (w.start - (+run.start || 0)) * 1000 }; });
  }
  function textOfWords(ws) { return ws.map(function (w) { return w.t; }).join(' '); }
  /* the word whose span holds the character offset idx of textOfWords(ws) (not only one that starts exactly there) */
  function wordAt(ws, idx) {
    var pos = 0;
    for (var i = 0; i < ws.length; i++) { var end = pos + ws[i].t.length; if (idx <= end) return i; pos = end + 1; }
    return Math.max(0, ws.length - 1);
  }
  /* cut a line's words at each cue: [{ words, kind }] with kind 'cue' | 'armed' (a bare wake word at the end) | null (no cue). cue is B68Cue's find */
  function segmentsOf(words, cue) {
    var f = cue && words.length ? cue.find(textOfWords(words)) : null;
    if (!f) return [{ words: words, kind: null }];
    var segs = [], wi = wordAt(words, f.index), rest = words;
    if (wi > 0) { segs.push({ words: words.slice(0, wi), kind: null }); rest = words.slice(wi); f = cue.find(textOfWords(rest)) || f; }
    for (var guard = 0; guard < 8; guard++) {
      if (f.pending) { segs.push({ words: rest, kind: 'armed' }); return segs; }
      var tail = rest.slice(1), g = tail.length ? cue.find(textOfWords(tail)) : null, k = g ? wordAt(tail, g.index) : -1;
      if (!g || k < 1) { segs.push({ words: rest, kind: 'cue' }); return segs; }      /* a second cue must start at least two words in */
      segs.push({ words: rest.slice(0, k + 1), kind: 'cue' });
      rest = rest.slice(k + 1); f = cue.find(textOfWords(rest));
      if (!f) { segs.push({ words: rest, kind: null }); return segs; }
    }
    segs.push({ words: rest, kind: 'cue' });
    return segs;
  }
  /* runs -> lines: same speaker, same connection, within MERGE_GAP_S of audio -> one line. emit(line) gets { speaker, text, at, conn },
     plus cue: true on a line that holds a cue and urgent: true on a line to post at once (a cued line, and the one straight after it).
     cue: B68Cue (its find). Without it nothing below the plain merge runs.
     The cue (design 1.4): after each run is added the whole open line is checked, and cut by Deepgram's words at the cue (the words before
     close the line, the cue starts a new one). A line ending in a bare wake word arms for ARM_S seconds of audio: the next run starting within that joins it, whatever its label.
     A line holding a cue takes a run within CUE_TAIL_MS of the last, whatever its label, then closes at once; with none it closes when
     tick() sees CUE_TAIL_MS pass. Nothing here waits for speech_final. */
  function makeMerger(emit, clock, cue) {
    var open = null, now = clock || function () { return Date.now(); }, afterUntil = -1;
    function lineOf(words, conn, t) {
      return { words: words, speaker: words[0].speaker, text: textOfWords(words), end: words[words.length - 1].end, conn: conn, at: words[0].at, opened: t, updated: t, cue: false, armed: false };
    }
    function out(l, isCue, urgent) {
      var o = { speaker: l.speaker, text: l.text, at: l.at, conn: l.conn };
      if (isCue) { o.cue = true; afterUntil = now() + AFTER_CUE_MS; }
      if (isCue || urgent) o.urgent = true;
      emit(o);
    }
    function flush() { if (open) { var o = open; open = null; out(o, o.cue, false); } }
    /* cut the open line at its cues: every part but the last goes now, the last stays open */
    function settle(joinedCue) {
      var segs = segmentsOf(open.words, cue), meta = open;
      if (segs.length === 1 && !segs[0].kind && !meta.cue && !meta.armed) return;
      var t = now();
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i], first = i === 0 && segs.length === 1;
        var ln = lineOf(s.words, meta.conn, first ? meta.opened : t);
        if (first) { ln.updated = meta.updated; ln.at = meta.at; }
        ln.cue = s.kind === 'cue'; ln.armed = s.kind === 'armed';
        if (i < segs.length - 1) out(ln, ln.cue, false);
        else if (ln.cue && joinedCue && segs.length === 1) { open = null; out(ln, true, false); return; }
        else open = ln;
      }
    }
    return {
      add: function (run, conn, at) {
        var t = now(), words = wordsOf(run, at), joined = false, joinedCue = false;
        if (open && open.conn === conn) {
          if (open.cue) { if (t - open.updated <= CUE_TAIL_MS) { joined = true; joinedCue = true; } }
          else if (open.armed && run.start - open.end <= ARM_S) joined = true;       /* AUDIO time: a final lands after the words, so the wall clock would lose a long command */
          else if (open.speaker === run.speaker && run.start - open.end <= MERGE_GAP_S && open.text.length + run.text.length < MAX_LINE) joined = true;
        }
        if (joined) {
          open.words = open.words.concat(words); open.text = textOfWords(open.words); open.end = run.end; open.updated = t;
          if (cue) settle(joinedCue);
          return;
        }
        flush();
        var after = t <= afterUntil; afterUntil = -1;                 /* the one line after a cue; used or not, the chance is gone */
        open = lineOf(words, conn, t);
        if (cue) settle(false);
        if (open && !open.cue && !open.armed && after) { var o = open; open = null; out(o, false, true); }
      },
      tick: function () {
        var t = now(); if (!open) return;
        if (open.cue ? t - open.updated > CUE_TAIL_MS || t - open.opened >= MAX_OPEN_MS : t - open.updated >= IDLE_CLOSE_MS || t - open.opened >= MAX_OPEN_MS) flush();
      },
      flush: flush,
      open: function () { return open; }
    };
  }
  var Pure = { downsample: downsample, runsOf: runsOf, makeMerger: makeMerger, lineId: lineId, DG_URL: DG_URL, SCHEMES: SCHEMES };
  if (!W || !W.document) return Pure;

  /* ---------- the controller ---------- */
  var document = W.document;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function errText(e) { return e && e.message || String(e || 'unknown error'); }
  function lsGet(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { W.localStorage.setItem(k, v); } catch (e) {} }

  function attach(container, opts) {
    var gm = opts && opts.gm;
    if (!gm || typeof gm.stt !== 'function' || typeof gm.sttToken !== 'function') return { destroy: function () {}, state: function () { return 'off'; }, feed: function () {} };
    var s = { dead: false, want: 'off', session: '', fed: null, lastReport: 0, running: false, state: 'idle', error: '', sent: 0, queue: [], posting: false,
      ws: null, conn: '', connAt: 0, scheme: lsGet(SCHEME_KEY), stream: null, ctx: null, src: null, proc: null, buffer: [], lastSent: 0,
      attempt: 0, startedAt: 0, timers: [], retry: null, stopping: false, merger: null };
    var tap = el('button', 'dp-btn stt-tap', 'Tap to start listening'); tap.type = 'button'; tap.hidden = true;
    var pill = el('div', 'stt-pill'); pill.hidden = true; pill.setAttribute('role', 'status');
    pill.appendChild(el('span', 'stt-dot')); var pillText = el('span', 'stt-text', 'Listening'); pill.appendChild(pillText);
    container.appendChild(tap); container.appendChild(pill);
    s.merger = makeMerger(function (l) { push({ kind: 'line', speaker: l.speaker, text: l.text, at: l.at, conn: l.conn, cue: l.cue === true, urgent: l.urgent === true }); }, null, W.B68Cue);

    function every(fn, ms) { var id = W.setInterval(function () { if (!s.dead) fn(); }, ms); s.timers.push(id); return id; }
    function paint() {
      var listening = s.running && !s.stopping;
      pill.hidden = !listening;
      pill.classList.toggle('stt-warn', s.state === 'reconnecting' || s.state === 'error');
      pillText.textContent = s.state === 'reconnecting' ? 'Listening · reconnecting' : 'Listening';
      tap.hidden = !(s.want === 'on' && (!s.running || s.needTap));
      tap.textContent = s.running && s.needTap ? 'Tap to keep listening' : 'Tap to start listening';
    }
    function report() {
      if (!gm.patchStt) return;
      s.lastReport = Date.now();
      Promise.resolve().then(function () { return gm.patchStt({ status: { state: s.state, lines: s.sent, error: s.error } }); }).catch(function () {});
    }
    function setState(st, err) { s.state = st; if (err !== undefined) s.error = err; paint(); report(); }

    /* ---- the lines out ---- */
    function push(line) {
      var text = String(line.text || '').replace(/\s+/g, ' ').trim(); if (!text && line.kind !== 'mark') return;
      var item = { id: lineId(), session: s.session, at: new Date(line.at || Date.now()).toISOString(),
        conn: s.conn, speaker: line.speaker === undefined ? null : line.speaker, kind: line.kind || 'line', text: text.slice(0, 2000) };
      if (line.cue === true) item.cue = true;       /* a boolean, only when true (the server may not keep it: see the report) */
      s.queue.push(item);
      if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
      if (line.cue === true || line.urgent === true) { s.hurry = true; send(); }      /* a cued line, or the one after it, does not wait for the 3 s round */
    }
    function send() {
      if (s.posting || !s.queue.length) return;
      var batch = s.queue.slice(0, BATCH); s.posting = true; s.hurry = false;
      Promise.resolve().then(function () { return gm.addTranscript(batch); }).then(function () {
        var ids = {}; batch.forEach(function (l) { ids[l.id] = 1; });
        s.queue = s.queue.filter(function (l) { return !ids[l.id]; }); s.sent += batch.length;
      }, function () { s.hurry = false; /* kept: the next round tries again */ }).then(function () { s.posting = false; if (s.hurry) send(); });
    }

    /* ---- the mic ---- */
    function startAudio() {
      var md = W.navigator && W.navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') return Promise.reject(new Error('this browser cannot use the microphone here'));
      return md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
        var AC = W.AudioContext || W.webkitAudioContext; if (!AC) throw new Error('no audio support');
        var ctx = new AC(), src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = function (ev) {
          if (!s.running || s.stopping) return;
          var pcm = downsample(ev.inputBuffer.getChannelData(0), ctx.sampleRate, RATE);
          if (s.ws && s.ws.readyState === 1) { flushBuffer(); s.ws.send(pcm.buffer); s.lastSent = Date.now(); }
          else { s.buffer.push(pcm.buffer); if (s.buffer.length > MAX_BUFFER) s.buffer.shift(); }
        };
        src.connect(proc); proc.connect(ctx.destination);
        stream.getAudioTracks().forEach(function (t) { t.addEventListener('ended', function () { if (s.running && !s.stopping) { s.needTap = true; s.error = 'the iPad closed the microphone'; paint(); report(); } }); });
        s.stream = stream; s.ctx = ctx; s.src = src; s.proc = proc;
        return ctx.resume ? ctx.resume() : null;
      });
    }
    function stopAudio() {
      try { if (s.proc) { s.proc.onaudioprocess = null; s.proc.disconnect(); } } catch (e) {}
      try { if (s.src) s.src.disconnect(); } catch (e) {}
      try { if (s.stream) s.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (s.ctx && s.ctx.close) s.ctx.close(); } catch (e) {}
      s.proc = s.src = s.stream = s.ctx = null;
    }
    function flushBuffer() { while (s.buffer.length && s.ws && s.ws.readyState === 1) s.ws.send(s.buffer.shift()); }

    /* ---- Deepgram ---- */
    function connect() {
      if (!s.running || s.stopping || s.dead) return;
      var conn = 'c' + Date.now().toString(36);
      Promise.resolve().then(function () { return gm.sttToken(); }).then(function (r) {
        if (!s.running || s.stopping || s.dead) return;
        var order = s.scheme && SCHEMES.indexOf(s.scheme) >= 0 ? [s.scheme].concat(SCHEMES.filter(function (x) { return x !== s.scheme; })) : SCHEMES.slice();
        tryScheme(r.token, order, 0, conn);
      }, function (e) { fail(e && e.status === 503 ? 'listening is not set up on the server (no Deepgram key)' : 'no token: ' + errText(e), e && e.status === 503); });
    }
    function tryScheme(token, order, i, conn) {
      var ws, opened = false;
      try { ws = new W.WebSocket(DG_URL, [order[i], token]); } catch (e) { fail('could not open the connection: ' + errText(e)); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () {
        opened = true; s.ws = ws; s.conn = conn; s.connAt = Date.now(); s.attempt = 0; s.scheme = order[i]; lsSet(SCHEME_KEY, order[i]);
        flushBuffer(); setState('listening', '');
      };
      ws.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || m.type !== 'Results' || !m.is_final) return;
        var alt = m.channel && m.channel.alternatives && m.channel.alternatives[0]; if (!alt) return;
        runsOf(alt.words, alt.transcript).forEach(function (run) { s.merger.add(run, conn, s.connAt + run.start * 1000); });
      };
      ws.onclose = function () {
        if (s.ws === ws) s.ws = null;
        if (!opened) { if (i + 1 < order.length && !s.stopping) tryScheme(token, order, i + 1, conn); else retry('Deepgram refused the connection'); return; }
        if (s.running && !s.stopping && !s.dead) { s.merger.flush(); push({ kind: 'mark', text: 'reconnected', speaker: null }); retry('connection dropped'); }
      };
      ws.onerror = function () { /* onclose follows */ };
    }
    function retry(why) {
      if (!s.running || s.stopping || s.dead) return;
      setState('reconnecting', why);
      var ms = BACKOFF[Math.min(s.attempt, BACKOFF.length - 1)]; s.attempt++;
      s.retry = W.setTimeout(function () { s.retry = null; connect(); }, ms);
    }
    function fail(why, fatal) { if (fatal) { setState('error', why); stop(true); } else retry(why); }

    /* ---- start and stop ---- */
    function start() {
      if (s.running) { if (s.needTap) resume(); return; }
      s.running = true; s.stopping = false; s.needTap = false; s.startedAt = Date.now(); s.attempt = 0; s.error = '';
      setState('starting', '');
      startAudio().then(function () { if (s.running) connect(); }, function (e) {
        s.running = false; stopAudio();
        setState('error', /denied|NotAllowed/i.test(errText(e) + (e && e.name)) ? 'the microphone was not allowed: allow it in Settings > Safari > Microphone' : errText(e));
      });
    }
    /* back from the background: iPad Safari may have suspended the audio or closed the mic; a tap brings it back */
    function resume() {
      s.needTap = false;
      var live = s.stream && s.stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; });
      if (live && s.ctx && s.ctx.resume) { s.ctx.resume().then(paint, function () { s.needTap = true; paint(); }); return; }
      stopAudio();
      startAudio().then(function () { s.error = ''; paint(); report(); }, function (e) { s.needTap = true; setState('error', errText(e)); });
    }
    function stop(keepState) {
      if (!s.running) { paint(); return; }
      s.stopping = true; paint();
      if (s.retry) { W.clearTimeout(s.retry); s.retry = null; }
      var ws = s.ws;
      try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) {}
      W.setTimeout(function () {
        try { if (ws) ws.close(); } catch (e) {}
        s.ws = null; s.merger.flush(); stopAudio(); s.buffer = [];
        s.running = false; s.stopping = false; s.needTap = false;
        send();
        if (!keepState) setState('stopped'); else paint();
      }, ws ? T.stopGrace : 0);
    }

    /* ---- the loop: what the GM wants, the merger's clock, the sender, keepalive, status ---- */
    function take(want, session) {
      s.want = want === 'on' ? 'on' : 'off'; s.session = typeof session === 'string' ? session : '';
      if (s.want === 'off' && s.running && !s.stopping) stop();
      paint();
    }
    /* what the GM wants comes with the display page's poll (feed); this GET is the fallback for a server whose display answers
       carry no such part, and for the moment before the first answer. It does nothing while the display poll is feeding. */
    function poll() {
      if (s.dead || s.fed === true) return;
      Promise.resolve().then(function () { return gm.stt(); }).then(function (r) {
        if (s.dead || s.fed === true) return;       /* the display poll took over while this was out */
        var d = r && r.doc || {};
        take(d.want, d.session);
      }, function () {});
    }
    function feed(part) {
      if (s.dead) return;
      if (part && (part.want === 'on' || part.want === 'off')) { s.fed = true; take(part.want, part.session); }
      else if (s.fed !== false) { s.fed = false; poll(); }       /* no part in the answer: the old way, starting now */
    }
    every(poll, T.poll);
    every(function () { s.merger.tick(); }, T.tick);
    every(send, T.flush);
    every(function () { if (s.running || (!document.hidden && Date.now() - s.lastReport >= T.idleStatus)) report(); }, T.status);
    every(function () {
      if (s.ws && s.ws.readyState === 1 && Date.now() - s.lastSent > 3000) { try { s.ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch (e) {} }
      if (s.running && Date.now() - s.startedAt > T.maxSession) { s.error = 'stopped after 6 hours'; stop(); }
    }, T.keepalive);
    tap.addEventListener('click', function (ev) { ev.stopPropagation(); start(); });
    function onVis() {
      if (document.hidden || !s.running) return;
      if (s.ctx && s.ctx.state !== 'running') { s.needTap = true; paint(); }
      poll();
    }
    document.addEventListener('visibilitychange', onVis);

    return {
      state: function () { return { want: s.want, session: s.session, fed: s.fed, running: s.running, state: s.state, queued: s.queue.length, sent: s.sent, scheme: s.scheme, error: s.error }; },
      feed: feed,
      destroy: function () {
        s.timers.forEach(function (id) { W.clearInterval(id); }); s.timers = [];
        document.removeEventListener('visibilitychange', onVis);
        if (s.running) { s.stopping = true; try { if (s.ws) s.ws.close(); } catch (e) {} s.merger.flush(); stopAudio(); s.running = false; send(); setState('stopped'); }
        s.dead = true;
        try { tap.remove(); pill.remove(); } catch (e) {}
      }
    };
  }

  Pure.attach = attach;
  return Pure;
});
