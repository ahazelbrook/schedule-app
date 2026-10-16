/* Hosted runtime adapter (Cloudflare Worker + Access + D1).
   Defines window.claude.use('user' | 'db' | 'downloads') on top of the JSON API in functions/
   (see HOSTING.md) so the page runs unchanged outside the claude.ai artifact. The db serves the
   `characters` collection, the shared `campaign/main` document (CAMPAIGN.md) and the `npcs` collection (CAST.md).
   window.claude.rules (list, import, saveHouse, deleteHouse) is the rules wiki's corpus (RULES.md).
   window.claude.gm (pack, packPart, importPart, removePart, state, patchState, display, setDisplay, ambient,
   patchAmbient, stt, patchStt, sttToken, transcript, addTranscript) is the GM tools'
   API (GM.md): plain calls, never queued, cached or snapshotted here.
   window.claude.profile.setName(name) changes the signed-in person's own display name (PATCH /api/me); a plain call too.
   Offline: the last loaded data is kept in localStorage per user, the page can start from it when the network
   is unreachable, and writes queue (in order, in localStorage) until it is back. It also makes the hosted page
   installable (manifest, icons, service worker sw.js).
   Inside the artifact window.claude already exists and this file does nothing. */
(function () {
  'use strict';
  if (window.claude) return;
  /* only on the hosted site: from file:// (local checks, a saved copy) there is no API, so define nothing */
  var proto = window.location && window.location.protocol;
  if (proto !== 'http:' && proto !== 'https:') return;

  var COLLECTION = 'characters';
  var CAMPAIGN = 'campaign', CAMPAIGN_ID = 'main';   /* the one shared campaign document (CAMPAIGN.md) */
  var NPCS = 'npcs';           /* the cast (CAST.md): the GM writes, a player is sent only the revealed NPCs */
  var LOG_MAX = 200;           /* the server keeps the newest 200 campaign log entries */
  var SIGNED_OUT = 'signed out: reload the page to sign in again';
  var CONFLICT_RETRIES = 2;      /* a write answered 409 (the row kept changing) is sent again this many times */
  var MEMBERS_TTL_MS = 60000;
  var STORE = 'b68.cf.', LAST = 'b68.cf.last';   /* localStorage: b68.cf.<user id>#<campaign> (+ '#queue'), and which user was last */
  var COALESCE_MAX = 200000;     /* never merge queued patches into a body near the server's 256 KiB limit */
  var READ_TIMEOUT_MS = 15000, WRITE_TIMEOUT_MS = 25000;   /* a request with no answer by then is abandoned (a stalled connection) */
  function snapshotMs() { return typeof window.__B68_SNAPSHOT_MS === 'number' ? window.__B68_SNAPSHOT_MS : 2000; }
  function timeoutMs(method) {
    if (typeof window.__B68_TIMEOUT_MS === 'number') return window.__B68_TIMEOUT_MS;
    return method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  }

  /* ---------- helpers ---------- */
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function pollMs() {
    if (typeof window.__B68_POLL_MS === 'number') return window.__B68_POLL_MS;
    return document.hidden ? 20000 : 4000;
  }
  /* the server's PATCH semantics: objects merge, arrays and scalars replace, null deletes */
  function deepMerge(target, patch) {
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v === null) delete target[k];
      else if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
      else target[k] = clone(v);
    });
    return target;
  }
  /* trim a campaign doc's log as the server does */
  function trimLog(doc) { if (doc && Array.isArray(doc.log) && doc.log.length > LOG_MAX) doc.log = doc.log.slice(0, LOG_MAX); return doc; }
  /* the server's PATCH rule for the campaign log (functions/_lib/campaign.js, mergeLog): incoming entries
     are added, never replace. Already stored (same at + by + text): skipped. Same at + by, other text:
     skipped here (the server refuses it for a player and ignores it for the GM). Then newest `at` first
     (stable), at most LOG_MAX. */
  function mergeLog(stored, incoming) {
    var old = Array.isArray(stored) ? stored.filter(isObj) : [];
    function entryKey(e) { return JSON.stringify([e.at, e.by, e.text]); }
    function slotKey(e) { return JSON.stringify([e.at, e.by]); }
    var have = {}, slots = {}, added = [];
    old.forEach(function (e) { have[entryKey(e)] = true; slots[slotKey(e)] = true; });
    (Array.isArray(incoming) ? incoming : []).forEach(function (e) {
      if (!isObj(e) || have[entryKey(e)] || slots[slotKey(e)]) return;
      have[entryKey(e)] = true; slots[slotKey(e)] = true; added.push(clone(e));
    });
    if (!added.length) return old.slice(0, LOG_MAX);
    function at(e) { return typeof e.at === 'string' ? e.at : ''; }
    return added.concat(old)
      .map(function (e, i) { return [e, i]; })
      .sort(function (a, b) { return at(a[0]) < at(b[0]) ? 1 : at(a[0]) > at(b[0]) ? -1 : a[1] - b[1]; })
      .map(function (x) { return x[0]; })
      .slice(0, LOG_MAX);
  }
  /* the server's PATCH for the campaign: the deep merge above, except `log`, whose entries are added */
  function mergeCampaign(doc, patch) {
    var rest = {};
    Object.keys(patch).forEach(function (k) { if (k !== 'log') rest[k] = patch[k]; });
    deepMerge(doc, rest);
    if ('log' in patch && Array.isArray(patch.log)) doc.log = mergeLog(doc.log, patch.log);
    return doc;
  }
  /* what a campaign with no stored document reads as (same as functions/_lib/campaign.js) */
  function defaultCampaign() {
    return {
      v: 1,
      session: { number: 0, startedAt: null, endedAt: null },
      crew: {
        name: '', type: '', lair: '', notes: '',
        tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0,
        claims: [], cohorts: [], factions: []
      },
      clocks: [],
      log: [],
      updatedAt: null
    };
  }
  function signedOutError() { var e = new Error(SIGNED_OUT); e.code = 'signed_out'; e.status = 401; return e; }
  function nowIso() { return new Date().toISOString(); }

  /* ---------- localStorage (every access may throw: private mode, quota, blocked storage) ---------- */
  function readJSON(key) {
    try { var s = window.localStorage, t = s && s.getItem(key); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }
  function writeJSON(key, v) {
    try { var s = window.localStorage; if (!s) return false; if (v == null) s.removeItem(key); else s.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function userKey(m) { return STORE + m.id + '#' + (m.campaign || 'default'); }

  /* ---------- status: window.B68Runtime.status and the `b68:runtime` event ---------- */
  var me = null;               /* the signed-in user ({ id, email, name, role, campaign }) */
  var mode = 'online';         /* 'snapshot' after an offline start, until /api/me answers again */
  var net = true;              /* the last request reached the server */
  var lastSync = null;         /* ISO time of the last successful poll or flushed write */
  var queue = [];              /* own writes not yet accepted by the server, oldest first */
  var sentStatus = null;
  var newBuild = null;         /* the server's build (X-B68-Build on every API answer, `build` in /api/me) when it differs from this page's */
  function status() { return { online: mode === 'online' && net, pending: queue.length, lastSync: lastSync, newBuild: newBuild }; }
  /* the page's build is routes.js's B68_BUILD; when the server reports another one a deploy happened while this page was
     open, and the header offers "Updated: reload" (boot.js whoami). Unknown on this side: nothing to say. An answer
     without the header (Access's sign-in page, a redirect) says nothing about the build and changes nothing. */
  function noteBuild(server) {
    if (typeof server !== 'string' || !server) return;
    var mine = typeof window.B68_BUILD === 'string' ? window.B68_BUILD : '';
    var next = mine && server !== mine ? server.slice(0, 40) : null;
    if (next !== newBuild) { newBuild = next; emitStatus(); }
  }
  function emitStatus() {
    var s = status(), j = JSON.stringify(s);
    if (window.B68Runtime) window.B68Runtime.status = s;
    if (j === sentStatus) return;
    sentStatus = j;
    try {
      if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent('b68:runtime', { detail: s }));
    } catch (e) {}
  }
  function setNet(v) { if (net !== v) { net = v; emitStatus(); } }

  /* ---------- the API ---------- */
  var signedOut = false;       /* the Access session ended (or another account signed in): stop polling, refuse writes */
  var onSignedOut = null;      /* set by the db layer */

  /* a rejection from fetch itself (no answer at all): the device is offline or the server is unreachable */
  function isNetErr(e) { return !!e && e.network === true; }

  /* fetch JSON. Rejects with Error(api error string). A 401, or anything that looks like the Access
     login page instead of our API (a followed or opaque redirect, a non-JSON body), marks the session signed out.
     A network failure rejects with an error carrying `network: true`. A request with no answer within timeoutMs()
     (15 s for a read, 25 s for a write: a connection that is "up" but dead, a dropped stream) is abandoned and rejects
     the same way (plus `timeout: true`), so a stalled request never holds the poller or the write queue: the next tick,
     the `online` event and the retry timer carry on as after any other network failure. */
  var signedOutWhy = '';       /* why the last 401 said so (the server's reason, or that Access answered with its login page) */
  function api(method, path, body) {
    if (signedOut) return Promise.reject(signedOutError());
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var ctl = null, timer = null, timedOut = false, limit = timeoutMs(method);
    if (typeof AbortController === 'function') { try { ctl = new AbortController(); opts.signal = ctl.signal; } catch (e) { ctl = null; } }
    function netFail(e) {
      setNet(false);
      var err;
      if (timedOut) { err = new Error('no answer from the server in ' + Math.round(limit / 1000) + ' s'); err.timeout = true; }
      else err = e instanceof Error ? e : new Error(String(e && e.message || e || 'network error'));
      try { err.network = true; } catch (x) { err = new Error(err.message); err.network = true; }
      throw err;
    }
    var sent;
    try { sent = fetch('/api' + path, opts); } catch (e) { sent = Promise.reject(e); }
    if (ctl) timer = setTimeout(function () { timedOut = true; try { ctl.abort(); } catch (e) {} }, limit);
    return Promise.resolve(sent).then(function (res) {
      setNet(true);
      noteBuild(res.headers && res.headers.get ? res.headers.get('x-b68-build') : null);
      var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (res.status === 401 || res.redirected || res.type === 'opaqueredirect' || ct.indexOf('json') < 0) {
        var out = function (why) {
          if (!signedOut) { signedOutWhy = why || ''; signedOut = true; if (onSignedOut) onSignedOut(); }
          throw signedOutError();
        };
        if (res.status === 401 && ct.indexOf('json') >= 0 && res.text) {
          return res.text().then(function (t) {
            var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
            return out(j && typeof j.reason === 'string' ? j.reason.slice(0, 60) : '');
          }, function () { return out(''); });
        }
        return out('Access answered with its sign-in page');
      }
      return res.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!res.ok) { var err = new Error((j && j.error) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
        return j;
      }, netFail);                               /* the headers came but the body did not (aborted, a dropped stream): a network failure too */
    }, netFail).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---------- user ---------- */
  var meP = null;
  /* /api/me once; null when not signed in or unreachable. When it is unreachable (fetch itself failed: not a 401,
     not a redirect to the sign-in page) and this browser holds a snapshot of the last signed-in user, the page
     comes up offline as that user from the snapshot (mode 'snapshot') and keeps trying to reach the server. */
  function loadMe() {
    if (!meP) meP = api('GET', '/me').then(function (m) {
      if (!m || !m.id) return null;
      if (typeof m.build === 'string') noteBuild(m.build);
      me = m; mode = 'online';
      writeJSON(LAST, { key: userKey(m), id: m.id });
      restore(m, null);
      return m;
    }, function (e) {
      if (!isNetErr(e)) return null;
      var last = readJSON(LAST), snap = last && last.key ? readJSON(last.key) : null;
      if (!snap || !snap.me || !snap.me.id || userKey(snap.me) !== last.key) return null;
      me = snap.me; mode = 'snapshot';
      restore(snap.me, snap);
      return me;
    }).then(function (m) {
      window.B68Runtime = { kind: 'cloudflare', me: m, status: status(), exportAll: exportAll, signedOutWhy: m ? '' : signedOutWhy };   /* me carries role, for the header */
      emitStatus();
      if (m && queue.length) flush();
      return m;
    });
    return meP;
  }

  /* GET /api/export (GM only, HOSTING.md): the whole campaign as the server holds it, for the page's "Download everything" */
  function exportAll() { return api('GET', '/export'); }

  var members = null;          /* { at, promise } */
  var membersById = null;      /* the last /api/members answer, kept in the snapshot */
  function loadMembers() {
    if (members && Date.now() - members.at < MEMBERS_TTL_MS) return members.promise;
    var p = api('GET', '/members').then(function (r) {
      var byId = {}; ((r && r.members) || []).forEach(function (m) { byId[m.id] = m; });
      membersById = byId; persistSoon();
      return byId;
    });
    members = { at: Date.now(), promise: p };
    p.catch(function () { members = null; });   /* do not cache a failure */
    return p;
  }

  function makeUser(m) {
    var gm = m.role === 'gm', disp = m.role === 'display';   /* display: the table iPad's own sign-in (DISPLAY_EMAILS): it reads the display and nothing else */
    return {
      id: function () { return Promise.resolve(m.id); },
      me: function () { return Promise.resolve({ id: m.id, name: m.name || '', email: m.email || m.id, isOwner: gm, canEdit: gm }); },
      can: function (name) { return Promise.resolve(name === 'data.write' && !disp); },
      isDisplay: function () { return Promise.resolve(disp); },
      isOwner: function () { return Promise.resolve(gm); },
      canEdit: function () { return Promise.resolve(gm); },
      /* every id passed gets an entry; name '' when unknown. Never rejects. */
      profiles: function (ids) {
        ids = typeof ids === 'string' ? [ids] : (ids || []);
        return loadMembers().catch(function () { return {}; }).then(function (byId) {
          var out = {};
          ids.forEach(function (id) { var x = byId[id]; out[id] = { id: id, name: (x && x.name) || '' }; });
          return out;
        });
      }
    };
  }

  /* ---------- db: one cache, one poller, many listeners ---------- */
  var cache = {};              /* id -> doc (live documents only) */
  var stamp = {};              /* id -> server updatedAt of the cached version */
  var pending = {};            /* id -> number of own writes in flight */
  var listeners = [];          /* { id?, query?, campaign?, cb, err } */
  var loaded = false;          /* the first full load has happened since start */
  var running = false, inflight = false, again = false, timer = null;
  var since = null, epoch = 0, errored = false;

  function docSnap(id) {
    var d = cache[id];
    return { id: id, exists: d !== undefined, data: function () { return clone(d); }, metadata: { fromCache: !status().online, hasPendingWrites: !!pending[id] } };
  }

  /* compare two field values for orderBy and range filters */
  function cmp(a, b) {
    if (a === b) return 0;
    if (a == null) return -1; if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    a = String(a); b = String(b); return a < b ? -1 : a > b ? 1 : 0;
  }
  function field(doc, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, doc); }
  var OPS = {
    '==': function (v, x) { return JSON.stringify(v) === JSON.stringify(x); },
    '!=': function (v, x) { return v !== undefined && JSON.stringify(v) !== JSON.stringify(x); },
    '<': function (v, x) { return v != null && cmp(v, x) < 0; },
    '<=': function (v, x) { return v != null && cmp(v, x) <= 0; },
    '>': function (v, x) { return v != null && cmp(v, x) > 0; },
    '>=': function (v, x) { return v != null && cmp(v, x) >= 0; },
    'in': function (v, x) { return Array.isArray(x) && x.some(function (y) { return JSON.stringify(y) === JSON.stringify(v); }); }
  };

  /* run a query over a map of id -> doc */
  function runQuery(q, docs) {
    var ids = Object.keys(docs).filter(function (id) {
      return q.where.every(function (w) { return OPS[w.op](field(docs[id], w.field), w.value); });
    });
    ids.sort(function (a, b) {
      for (var i = 0; i < q.order.length; i++) {
        var o = q.order[i], c = cmp(field(docs[a], o.field), field(docs[b], o.field));
        if (c) return o.dir === 'desc' ? -c : c;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (q.limit != null) ids = ids.slice(0, q.limit);
    return ids;
  }
  function querySnap(q, docs, snapOf) {
    var list = runQuery(q, docs).map(snapOf);
    return { docs: list, size: list.length, empty: !list.length, forEach: function (fn, self) { list.forEach(fn, self); } };
  }

  /* tell character listeners: doc listeners only when their document changed (or `all`), query listeners on any change */
  function notify(changed, all) {
    listeners.slice().forEach(function (l) {
      if (listeners.indexOf(l) < 0 || l.campaign || l.npcs) return;
      try {
        if (l.id !== undefined) { if (all || changed[l.id]) l.cb(docSnap(l.id)); }
        else if (all || Object.keys(changed).length) l.cb(querySnap(l.query, cache, docSnap));
      } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  function notifyErr(e) {
    listeners.slice().forEach(function (l) { if (l.err) { try { l.err(e); } catch (x) {} } });
  }

  /* ---------- the campaign document: cached beside the characters, refreshed through the same poller ----------
     Each /api/characters answer carries campaignUpdatedAt; when it differs from the stamp of the cached copy,
     the poll goes on to GET /api/campaign. Only maintained while someone listens to campaign/main. */
  var camp = {
    doc: null,                 /* the cached document (the default one when none is stored) */
    stamp: undefined,          /* the server updatedAt of the cached copy: null = no stored doc, undefined = unknown */
    loaded: false,             /* fetched since the first campaign listener subscribed */
    pending: 0,                /* own campaign writes in flight */
    epoch: 0                   /* bumped by own writes, so a fetch that overlapped one is dropped */
  };
  function hasCampaignListeners() { return listeners.some(function (l) { return l.campaign; }); }
  function campSnap() {
    var d = camp.doc || defaultCampaign();
    return { id: CAMPAIGN_ID, exists: true, data: function () { return clone(d); }, metadata: { fromCache: !status().online, hasPendingWrites: camp.pending > 0 } };
  }
  function notifyCampaign() {
    listeners.slice().forEach(function (l) {
      if (!l.campaign || listeners.indexOf(l) < 0) return;
      try { l.cb(campSnap()); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  /* take a server answer ({ doc, updatedAt }); listeners hear about it on the first load and on real changes only */
  function applyCampaign(r) {
    var doc = r && isObj(r.doc) ? r.doc : defaultCampaign();
    var first = !camp.loaded, changed = JSON.stringify(doc) !== JSON.stringify(camp.doc);
    camp.doc = doc; camp.stamp = (r && r.updatedAt) || null; camp.loaded = true;
    if (first || changed) notifyCampaign();
    persistSoon();
  }
  /* after a characters poll: refetch the campaign when its stamp moved (or it was never loaded) */
  function syncCampaign(serverAt) {
    if (!running || camp.pending || !hasCampaignListeners()) return;
    if (camp.loaded && serverAt !== undefined && serverAt === camp.stamp) return;   /* unchanged: nothing to do */
    var at = camp.epoch;
    return api('GET', '/' + CAMPAIGN).then(function (r) {
      if (at !== camp.epoch) { again = true; return; }   /* an own write overlapped: ask again */
      if (running && hasCampaignListeners()) applyCampaign(r);
    });
  }

  /* ---------- the cast: the `npcs` collection, cached beside the characters, refreshed through the same poller ----------
     Each /api/characters answer carries npcsUpdatedAt (the newest change of any NPC row, hidden ones included); only when it
     differs from the stamp of the cached copy does the poll go on to GET /api/npcs (the whole list: a table has a few dozen
     NPCs). Nothing is fetched while nobody listens to `npcs`. The server sends a player only the revealed NPCs. */
  var npcs = {
    docs: {},                  /* id -> doc (live ones the viewer may see) */
    stamp: {},                 /* id -> server updatedAt of the cached version */
    at: undefined,             /* the server npcsUpdatedAt of the cached copy: null = no rows, undefined = unknown */
    loaded: false,             /* fetched since the first npcs listener subscribed */
    pending: {},               /* id -> own writes in flight */
    epoch: 0                   /* bumped by own writes, so a fetch that overlapped one is dropped */
  };
  function hasNpcListeners() { return listeners.some(function (l) { return l.npcs; }); }
  function npcSnap(id) {
    var d = npcs.docs[id];
    return { id: id, exists: d !== undefined, data: function () { return clone(d); }, metadata: { fromCache: !status().online, hasPendingWrites: !!npcs.pending[id] } };
  }
  function notifyNpcs(changed, all) {
    listeners.slice().forEach(function (l) {
      if (!l.npcs || listeners.indexOf(l) < 0) return;
      try {
        if (l.id !== undefined) { if (all || changed[l.id]) l.cb(npcSnap(l.id)); }
        else if (all || Object.keys(changed).length) l.cb(querySnap(l.query, npcs.docs, npcSnap));
      } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  /* take GET /api/npcs: the list replaces the cache (rows with own writes in flight are kept as they are) */
  function applyNpcs(r) {
    var rows = (r && r.docs) || [], changed = {}, next = {}, nextStamp = {};
    rows.forEach(function (row) {
      if (npcs.pending[row.id] || row.deleted || !row.doc) return;
      next[row.id] = row.doc; nextStamp[row.id] = row.updatedAt || (row.doc && row.doc.updatedAt) || '';
    });
    Object.keys(npcs.pending).forEach(function (id) { if (id in npcs.docs) { next[id] = npcs.docs[id]; nextStamp[id] = npcs.stamp[id]; } });
    Object.keys(next).forEach(function (id) { if (!(id in npcs.docs) || npcs.stamp[id] !== nextStamp[id]) changed[id] = true; });
    Object.keys(npcs.docs).forEach(function (id) { if (!(id in next)) changed[id] = true; });
    var first = !npcs.loaded;
    npcs.docs = next; npcs.stamp = nextStamp; npcs.at = (r && r.npcsUpdatedAt) || null; npcs.loaded = true;
    notifyNpcs(changed, first);
    persistSoon();
  }
  /* after a characters poll: refetch the cast when its stamp moved (or it was never loaded) */
  function syncNpcs(serverAt) {
    if (!running || !hasNpcListeners() || Object.keys(npcs.pending).length) return;
    if (npcs.loaded && (serverAt === undefined || serverAt === npcs.at)) return;   /* unchanged (or an older server): nothing to do */
    var at = npcs.epoch;
    return api('GET', '/' + NPCS).then(function (r) {
      if (at !== npcs.epoch) { again = true; return; }   /* an own write overlapped: ask again */
      if (running && hasNpcListeners()) applyNpcs(r);
    }).catch(function (e) {
      if (isNetErr(e) || signedOut) throw e;            /* the poll reports those */
      listeners.slice().forEach(function (l) { if (l.npcs && l.err) { try { l.err(e); } catch (x) {} } });   /* the cast alone failed: only its listeners hear */
    });
  }

  /* apply a /api/characters response idempotently (a row whose updatedAt we already hold changes nothing);
     rows for documents with own writes in flight are left alone */
  function applyServer(r, full) {
    var changed = {};
    if (full) {
      var keep = {}, keepStamp = {};
      Object.keys(pending).forEach(function (id) { if (id in cache) { keep[id] = cache[id]; keepStamp[id] = stamp[id]; } });
      cache = keep; stamp = keepStamp;
    }
    (r.docs || []).forEach(function (row) {
      var id = row.id; if (pending[id]) return;
      var at = row.updatedAt || (row.doc && row.doc.updatedAt) || '';
      if (row.deleted || !row.doc) {
        if (id in cache) { delete cache[id]; delete stamp[id]; changed[id] = true; }
      } else if (!(id in cache) || stamp[id] !== at) {
        cache[id] = row.doc; stamp[id] = at; changed[id] = true;
      }
    });
    if (r.now) since = r.now;      /* reported 2 s behind, so recent rows repeat: the updatedAt check above makes that a no-op */
    loaded = true;
    notify(changed, full);
    persistSoon();
  }

  function schedule(ms) {
    clearTimeout(timer); timer = null;
    if (running && !signedOut) timer = setTimeout(tick, ms == null ? pollMs() : ms);
  }
  function tick() {
    timer = null;
    if (!running || signedOut) return;
    if (inflight) { again = true; return; }
    inflight = true;
    if (mode === 'snapshot') {
      /* started offline: ask /api/me again first; once it answers (same user) the next tick does a full load */
      reconnect().then(function (ok) {
        inflight = false;
        if (ok) { flush(); schedule(0); } else if (again) { again = false; schedule(); } else schedule();
      });
      return;
    }
    var full = !loaded, at = epoch, campAt = camp.epoch;
    api('GET', '/' + COLLECTION + (full ? '' : '?since=' + encodeURIComponent(since)))
      .then(function (r) {
        r = r || {};
        lastSync = nowIso();                          /* before applyServer, so the snapshot it saves carries it */
        /* a write started or finished while this poll was out: its view may be stale, ask again */
        if (at !== epoch) again = true;
        else if (running) applyServer(r, full);
        if (campAt !== camp.epoch) { again = true; return; }
        return Promise.resolve(syncCampaign(r.campaignUpdatedAt)).then(function () { return syncNpcs(r.npcsUpdatedAt); });
      })
      .then(function () {
        errored = false; emitStatus();
        flush();                                      /* the network answers: send what queued up */
      }, function (e) {
        if (signedOut) return;                        /* reported by onSignedOut */
        if (!errored) { errored = true; notifyErr(e); } /* surface once; retry on the next tick */
      })
      .then(function () {
        inflight = false;
        if (again) { again = false; schedule(0); } else schedule();
      });
  }
  /* epoch++: drop a poll left over from before a stop. After an offline start the snapshot stays loaded. */
  function start() { if (running) return; running = true; if (mode !== 'snapshot') loaded = false; errored = false; epoch++; schedule(0); }
  function stop() { running = false; if (mode !== 'snapshot') { loaded = false; camp.loaded = false; npcs.loaded = false; } again = false; clearTimeout(timer); timer = null; }
  function pollSoon() { if (!running) return; if (inflight) again = true; else schedule(0); }

  /* the session is over (signed out, or another account signed in): stop, tell every listener once.
     Queued writes stay in localStorage for this user's next visit. */
  function endSession(err) {
    if (!signedOut) signedOut = true;
    stop(); notifyErr(err);
    queue.forEach(function (q) { settleWaiters(q, err); q.claim = null; });
    saveQueue();                 /* kept for the next visit, unclaimed */
    emitStatus();
  }
  onSignedOut = function () { endSession(signedOutError()); };
  if (document.addEventListener) document.addEventListener('visibilitychange', function () {
    if (document.hidden) saveNow();
    if (running && !inflight) schedule(document.hidden ? null : 0);
  });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', function () { kick(); });
    window.addEventListener('pagehide', function () { saveNow(); });
  }

  function subscribe(l) {
    listeners.push(l);
    var live = running || mode === 'snapshot';     /* after an offline start the snapshot is the current data */
    if (signedOut) { setTimeout(function () { if (l.err && listeners.indexOf(l) >= 0) l.err(signedOutError()); }, 0); }
    else if (l.campaign) {
      /* the first snapshot comes from the cache when it is current, else from the fetch the next poll makes */
      if (live && camp.loaded) setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(campSnap()); }, 0);
      else pollSoon();
    }
    else if (l.npcs) {
      if (live && npcs.loaded) setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(l.id !== undefined ? npcSnap(l.id) : querySnap(l.query, npcs.docs, npcSnap)); }, 0);
      else pollSoon();
    }
    else if (live && loaded) {
      setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(l.id !== undefined ? docSnap(l.id) : querySnap(l.query, cache, docSnap)); }, 0);
    }
    start();   /* the poller runs while any listener (characters or campaign) exists */
    var done = false;
    return function unsubscribe() {
      if (done) return; done = true;
      var i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1);
      if (!listeners.length) stop();
      else {
        /* nobody keeps it current: refetch on the next subscribe */
        if (!hasCampaignListeners() && mode !== 'snapshot') camp.loaded = false;
        if (!hasNpcListeners() && mode !== 'snapshot') npcs.loaded = false;
      }
    };
  }

  /* send a write; a 409 (the row kept changing on the server) is sent again a few times */
  function send(method, path, body, n) {
    n = n || 0;
    return api(method, path, body).catch(function (e) {
      if (e.status !== 409 || n >= CONFLICT_RETRIES) throw e;
      return new Promise(function (ok) { setTimeout(ok, 150 * (n + 1)); }).then(function () { return send(method, path, body, n + 1); });
    });
  }

  /* ---------- the snapshot: the last loaded data, per user and campaign, for an offline start ---------- */
  var savedAt = 0, saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!me) return;
    savedAt = Date.now();
    writeJSON(userKey(me), {
      v: 1, me: me, savedAt: nowIso(), syncedAt: lastSync,
      docs: cache, stamps: stamp,
      campaign: camp.doc ? { doc: camp.doc, updatedAt: camp.stamp === undefined ? null : camp.stamp } : null,
      npcs: npcs.loaded ? { docs: npcs.docs, stamps: npcs.stamp, at: npcs.at === undefined ? null : npcs.at } : null,
      members: membersById
    });
  }
  /* at most one write every couple of seconds (a poll every 4 s with no changes still refreshes lastSync) */
  function persistSoon() {
    if (!me || saveTimer) return;
    var wait = snapshotMs() - (Date.now() - savedAt);
    if (wait <= 0) saveNow(); else saveTimer = setTimeout(saveNow, wait);
  }

  /* on start: this user's queued writes, and the snapshot (the whole cache after an offline start; online it only
     matters for documents with queued writes, which the first full load leaves alone). Queued writes are applied
     again on top: every one of them is idempotent (deep merge, log append with dedup, PUT, DELETE). */
  function restore(m, snap) {
    snap = snap || readJSON(userKey(m));
    if (snap && snap.me && snap.me.id === m.id) {
      if (isObj(snap.docs)) cache = snap.docs;
      if (isObj(snap.stamps)) stamp = snap.stamps;
      if (snap.campaign && isObj(snap.campaign.doc)) { camp.doc = snap.campaign.doc; camp.stamp = snap.campaign.updatedAt || null; }
      if (isObj(snap.members)) membersById = snap.members;
      if (snap.npcs && isObj(snap.npcs.docs)) { npcs.docs = snap.npcs.docs; npcs.stamp = isObj(snap.npcs.stamps) ? snap.npcs.stamps : {}; npcs.at = snap.npcs.at || null; }
      if (mode === 'snapshot') {
        lastSync = snap.syncedAt || null;
        loaded = true; camp.loaded = !!camp.doc; npcs.loaded = !!snap.npcs && isObj(snap.npcs.docs);
        if (membersById) members = { at: Infinity, promise: Promise.resolve(membersById) };
      }
    }
    var saved = readJSON(userKey(m) + '#queue');
    (Array.isArray(saved) ? saved : []).forEach(function (q, i) {
      if (!q || typeof q.path !== 'string' || ['PUT', 'PATCH', 'DELETE'].indexOf(q.method) < 0) return;
      q = { qid: q.qid || TAB + '.r' + i, saved: !!q.qid, mine: false, claim: null,
        kind: q.kind === 'campaign' || q.kind === 'npc' ? q.kind : 'char', id: q.id, method: q.method, path: q.path, body: q.body, waiters: [] };
      queue.push(q); bump(q, 1); applyLocal(q);
    });
  }

  /* ---------- the write queue ----------
     Every own write goes through it: applied to the cache at once, appended (and saved to localStorage), then
     sent in order, one at a time. The promise resolves when the server accepts the write, or as soon as it is
     queued while the network is unreachable (or failing with 5xx / 409); it rejects when the server refuses it
     while the caller is still waiting. A queued write the server refuses later is dropped, the cache is resynced
     and the error goes to the err callbacks. */
  var flushing = false, stalled = false, retryTimer = null;

  function bump(q, n) {
    if (q.kind === 'campaign') camp.pending = Math.max(0, camp.pending + n);
    else if (q.kind === 'npc') { npcs.pending[q.id] = (npcs.pending[q.id] || 0) + n; if (npcs.pending[q.id] <= 0) delete npcs.pending[q.id]; }
    else { pending[q.id] = (pending[q.id] || 0) + n; if (pending[q.id] <= 0) delete pending[q.id]; }
  }
  function applyLocal(q) {
    if (q.kind === 'campaign') {
      if (q.method === 'PUT') camp.doc = trimLog(clone(q.body));
      else if (q.method === 'PATCH' && camp.doc) mergeCampaign(camp.doc, q.body);
    } else if (q.kind === 'npc') {
      if (q.method === 'PUT') npcs.docs[q.id] = clone(q.body);
      else if (q.method === 'PATCH') { if (q.id in npcs.docs) deepMerge(npcs.docs[q.id], q.body); }
      else if (q.method === 'DELETE') delete npcs.docs[q.id];
    } else if (q.method === 'PUT') cache[q.id] = clone(q.body);
    else if (q.method === 'PATCH') { if (q.id in cache) deepMerge(cache[q.id], q.body); }
    else if (q.method === 'DELETE') delete cache[q.id];
  }
  /* Several tabs of one user share the stored queue. Each entry has a qid; a tab sends an entry only after
     claiming it in storage (no other tab's live claim), removes it when the server answered, and drops from
     memory entries another tab has finished. A tab only folds into entries it created itself. */
  var TAB = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var CLAIM_MS = 30000;
  var finished = {};           /* qids this tab has sent or dropped */
  function qkey() { return userKey(me) + '#queue'; }
  function stored() { var v = me ? readJSON(qkey()) : null; return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function plain(q, x) { return { qid: q.qid, kind: q.kind, id: q.id, method: q.method, path: q.path, body: q.body, claim: q.claim || (claimedElsewhere(x) ? x.claim : null) }; }
  function saveQueue() {
    if (!me) return;
    var mine = {}; queue.forEach(function (q) { mine[q.qid] = q; });
    var out = [], seen = {};
    stored().forEach(function (x) {
      if (!x.qid || finished[x.qid] || seen[x.qid]) return;
      seen[x.qid] = true; out.push(mine[x.qid] ? plain(mine[x.qid], x) : x);
    });
    queue.forEach(function (q) { if (!seen[q.qid] && !q.saved) { seen[q.qid] = true; out.push(plain(q)); } });
    if (writeJSON(qkey(), out.length ? out : null)) queue.forEach(function (q) { q.saved = true; });
  }
  /* entries this tab saved that are gone from storage were sent (or dropped) by another tab: forget them */
  function syncQueue() {
    var byId = {}, list = stored();
    list.forEach(function (x) { if (x.qid) byId[x.qid] = x; });
    queue.slice().forEach(function (q) {
      if (q.saved && !byId[q.qid] && q !== sendingQ) { queue.splice(queue.indexOf(q), 1); bump(q, -1); settleWaiters(q); }
    });
    return byId;
  }
  function claimedElsewhere(x) { return !!(x && x.claim && x.claim.tab !== TAB && x.claim.until > Date.now()); }
  function settleWaiters(q, err) {
    var ws = q.waiters; q.waiters = [];
    ws.forEach(function (w) { if (err) w.reject(err); else w.resolve(); });
  }
  /* a write started or finished: the poll in flight for that store may be stale */
  function epochUp(q) { if (q.kind === 'campaign') camp.epoch++; else if (q.kind === 'npc') npcs.epoch++; else epoch++; }
  function offlineNow() { return mode !== 'online' || stalled || !net; }

  /* can patch b, sent right after patch a to the same document, be folded into a? Only when one PATCH of the merged
     body is provably the same as the two in a row under the server's rule, whatever the stored document holds:
     at the top level anything goes except an object over a non-object; below it a null (a delete) or an object
     over a non-object is not safe (the stored value could be a non-object, which the first patch would replace
     with its literal object). The campaign `log` appends, so the two lists concatenate. Returns the merged
     patch or null. */
  function foldPatch(a, b, depth, campaign) {
    if (!isObj(a) || !isObj(b)) return null;
    var out = clone(a), keys = Object.keys(b);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], bv = b[k], has = Object.prototype.hasOwnProperty.call(a, k);
      if (campaign && depth === 0 && k === 'log') {
        if (!Array.isArray(bv) || (has && !Array.isArray(a.log))) return null;
        out.log = (has ? a.log : []).concat(clone(bv));
        continue;
      }
      if (bv === null) { if (depth > 0) return null; out[k] = null; continue; }
      if (isObj(bv)) {
        if (!has) { out[k] = clone(bv); continue; }
        if (!isObj(a[k])) return null;
        var sub = foldPatch(a[k], bv, depth + 1, false);
        if (!sub) return null;
        out[k] = sub; continue;
      }
      out[k] = clone(bv);
    }
    return out;
  }
  function tryFold(q) {
    var last = queue[queue.length - 1];
    if (!last || last === sendingQ || !last.mine || last.method !== 'PATCH' || q.method !== 'PATCH' || last.kind !== q.kind || last.path !== q.path) return false;
    /* never into an entry another tab is sending, or has already sent (gone from storage) */
    var x = stored().filter(function (e) { return e.qid === last.qid; })[0];
    if (last.saved ? !x || claimedElsewhere(x) : false) return false;
    /* a player's campaign patches are checked field by field: one refused change would sink both, so never fold them */
    if (q.kind === 'campaign' && !(me && me.role === 'gm')) return false;
    var merged = foldPatch(last.body, q.body, 0, q.kind === 'campaign');
    if (!merged || JSON.stringify(merged).length > COALESCE_MAX) return false;
    last.body = merged;
    return last;
  }
  var sendingQ = null, qseq = 0;
  function enqueue(q) {
    q.waiters = []; q.mine = true; q.saved = false;
    q.qid = TAB + '.' + (++qseq);
    var into = tryFold(q);
    if (!into) { queue.push(q); bump(q, 1); into = q; }
    saveQueue(); emitStatus();
    return new Promise(function (resolve, reject) {
      if (offlineNow() || signedOut) resolve();   /* queued: it goes out when the network is back (or at this user's next signed-in visit) */
      else into.waiters.push({ resolve: resolve, reject: reject });
    });
  }
  /* a write made after the session ended (E6): it stays in this user's stored queue, which the next visit (signed in again)
     sends, and the promise rejects now with the signed-out message, so the page says what to do (reload to sign in) rather
     than report a save that has not happened. Another account on this browser never sees or sends it (the queue is per user). */
  function keptForNextVisit(p) { return p.then(function () { throw signedOutError(); }); }
  function retryLater() {
    if (retryTimer || !queue.length || signedOut) return;
    retryTimer = setTimeout(function () { retryTimer = null; kick(); }, pollMs());
  }
  /* the network may be back: reconnect after an offline start, send the queue, poll */
  function kick() {
    if (signedOut || !me) return;
    if (mode === 'snapshot') {
      if (running) pollSoon();
      else reconnect().then(function (ok) { if (ok) flush(); else retryLater(); });
      return;
    }
    flush(); pollSoon();
  }
  function flush() {
    if (flushing || !queue.length || signedOut || !me) return;
    if (mode !== 'online') { retryLater(); return; }
    var byId = syncQueue();
    if (!queue.length) { stalled = false; emitStatus(); pollSoon(); return; }
    var q = queue[0], ch = {};
    if (claimedElsewhere(byId[q.qid])) { retryLater(); return; }    /* another tab is sending it */
    flushing = true;
    q.claim = { tab: TAB, until: Date.now() + CLAIM_MS }; saveQueue();
    if (q.kind === 'char') ch[q.id] = true;
    sendingQ = q;
    epochUp(q);
    send(q.method, q.path, q.body).then(function (r) {
      flushing = false; sendingQ = null; stalled = false;
      done(q);
      if (q.kind === 'campaign') {
        if (!camp.pending && hasCampaignListeners()) applyCampaign(r);
      } else if (q.kind === 'npc') {
        if (!npcs.pending[q.id]) {
          if (q.method === 'DELETE') { delete npcs.docs[q.id]; delete npcs.stamp[q.id]; }
          else if (r && r.doc) { npcs.docs[q.id] = r.doc; npcs.stamp[q.id] = r.doc.updatedAt || ''; }
          var nch = {}; nch[q.id] = true; notifyNpcs(nch);
        }
      } else if (!pending[q.id]) {
        if (q.method === 'DELETE') { delete cache[q.id]; delete stamp[q.id]; }
        else if (r && r.doc) { cache[q.id] = r.doc; stamp[q.id] = r.doc.updatedAt || ''; }
        notify(ch);
      }
      lastSync = nowIso(); emitStatus(); persistSoon();
      settleWaiters(q);
      if (queue.length) flush(); else pollSoon();
    }, function (e) {
      flushing = false; sendingQ = null;
      if (signedOut) return;                       /* endSession settled the waiters; the queue stays saved */
      if (isNetErr(e) || !e.status || e.status >= 500 || e.status === 409) {
        /* not refused, just not now: keep it (and everything after it), tell waiters it is queued, retry */
        stalled = true; q.claim = null; saveQueue();
        queue.forEach(function (x) { settleWaiters(x); });
        emitStatus(); retryLater();
        return;
      }
      /* refused (400 / 403 / 404 / 413 ...): drop it and resync what it touched from the server */
      done(q);
      if (q.kind === 'campaign') camp.stamp = undefined;    /* the next poll refetches and undoes the optimistic change */
      else if (q.kind === 'npc') npcs.at = undefined;       /* same for the cast */
      else if (running) loaded = false;                     /* a full load replaces the optimistic copy */
      pollSoon();
      emitStatus(); persistSoon();
      if (q.waiters.length) settleWaiters(q, e);
      else {
        var err = new Error('a change saved while offline was not accepted: ' + e.message);
        err.status = e.status; err.code = 'dropped';
        notifyErr(err);
      }
      flush();
    });
  }
  /* q has been answered: off the queue, no longer pending */
  function done(q) {
    finished[q.qid] = true;
    var i = queue.indexOf(q); if (i >= 0) queue.splice(i, 1);
    bump(q, -1);
    epochUp(q);
    saveQueue();
  }

  /* after an offline start: is the server back, and is it still the same person? */
  var reconnecting = null;
  function reconnect() {
    if (mode !== 'snapshot' || signedOut) return Promise.resolve(mode === 'online');
    if (reconnecting) return reconnecting;
    reconnecting = api('GET', '/me').then(function (m) {
      reconnecting = null;
      if (!m || !m.id) { endSession(signedOutError()); return false; }
      if (userKey(m) !== userKey(me)) {
        var e = new Error('signed in as ' + (m.email || m.id) + ' now: reload the page'); e.code = 'other_user'; e.status = 401;
        endSession(e); return false;
      }
      me = m; mode = 'online';
      writeJSON(LAST, { key: userKey(m), id: m.id });
      loaded = false; camp.stamp = undefined; npcs.at = undefined; members = null;      /* full load, campaign refetch, fresh names */
      if (window.B68Runtime) window.B68Runtime.me = m;
      emitStatus();
      return true;
    }, function () { reconnecting = null; return false; });   /* still offline (a 401 or redirect already ended the session) */
    return reconnecting;
  }

  /* an own write: update the cache now, queue it, send it; the server's version replaces the cache when it answers.
     After a sign-out it is still queued (kept for this user's next visit) but rejected, see keptForNextVisit. */
  function write(id, method, body, local) {
    var ch = {}; ch[id] = true;
    var p = enqueue({ kind: 'char', id: id, method: method, path: '/' + COLLECTION + '/' + encodeURIComponent(id), body: body === undefined ? undefined : clone(body) });
    epoch++;
    local(); notify(ch); persistSoon();
    if (signedOut) return keptForNextVisit(p);
    flush();
    return p;
  }

  function docRef(id) {
    return {
      id: id, path: COLLECTION + '/' + id,
      get: function () {
        return api('GET', '/' + COLLECTION + '/' + encodeURIComponent(id)).then(function (r) {
          var d = r && r.doc;
          return { id: id, exists: true, data: function () { return clone(d); }, metadata: { fromCache: false, hasPendingWrites: false } };
        }, function (e) {
          if (e.status === 404) return { id: id, exists: false, data: function () { return undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
          if (isNetErr(e) && loaded) return docSnap(id);     /* offline: the last loaded copy */
          throw e;
        });
      },
      set: function (doc) {
        return write(id, 'PUT', doc, function () { cache[id] = clone(doc); });
      },
      update: function (patch) {
        return write(id, 'PATCH', patch, function () { if (id in cache) deepMerge(cache[id], patch); });
      },
      delete: function () {
        return write(id, 'DELETE', undefined, function () { delete cache[id]; });
      },
      onSnapshot: function (cb, err) { return subscribe({ id: id, cb: cb, err: err }); }
    };
  }

  /* an own campaign write: same shape as write() above. The optimistic merge only applies to a loaded
     cache (before that there is nothing current to merge into), with the server's rule (mergeCampaign:
     deep merge, log entries added); the server's answer then replaces it. A rejected
     write (e.g. 403 for a player) forces a refetch so the optimistic change is rolled back. */
  function campaignWrite(method, body, local) {
    var p = enqueue({ kind: 'campaign', method: method, path: '/' + CAMPAIGN, body: clone(body) });
    camp.epoch++;
    if (camp.loaded) { local(); notifyCampaign(); persistSoon(); }
    if (signedOut) return keptForNextVisit(p);
    flush();
    return p;
  }

  function campaignRef() {
    return {
      id: CAMPAIGN_ID, path: CAMPAIGN + '/' + CAMPAIGN_ID,
      /* always exists: the server answers the default document while none is stored */
      get: function () {
        return api('GET', '/' + CAMPAIGN).then(function (r) {
          var d = r && isObj(r.doc) ? r.doc : defaultCampaign();
          return { id: CAMPAIGN_ID, exists: true, data: function () { return clone(d); }, metadata: { fromCache: false, hasPendingWrites: false } };
        }, function (e) {
          if (isNetErr(e) && camp.doc) return campSnap();      /* offline: the last loaded copy */
          throw e;
        });
      },
      set: function (doc) {
        return campaignWrite('PUT', doc, function () { camp.doc = trimLog(clone(doc)); });
      },
      update: function (patch) {
        return campaignWrite('PATCH', patch, function () { mergeCampaign(camp.doc, patch); });
      },
      onSnapshot: function (cb, err) { return subscribe({ campaign: true, cb: cb, err: err }); }
    };
  }

  /* an own write to the cast: the GM only (the server says 403 to anyone else, so a player's call is refused here at once).
     Same shape as write(): the cache changes now, the write is queued and sent, the server's version replaces it. */
  function npcWrite(id, method, body, local) {
    if (!me || me.role !== 'gm') { var e = new Error('only the GM can change the cast'); e.status = 403; return Promise.reject(e); }
    var ch = {}; ch[id] = true;
    var p = enqueue({ kind: 'npc', id: id, method: method, path: '/' + NPCS + '/' + encodeURIComponent(id), body: body === undefined ? undefined : clone(body) });
    npcs.epoch++;
    if (npcs.loaded) { local(); notifyNpcs(ch); persistSoon(); }
    if (signedOut) return keptForNextVisit(p);
    flush();
    return p;
  }
  function npcRef(id) {
    function snapOf(d) { return { id: id, exists: d !== undefined, data: function () { return clone(d); }, metadata: { fromCache: false, hasPendingWrites: false } }; }
    return {
      id: id, path: NPCS + '/' + id,
      get: function () {
        return api('GET', '/' + NPCS + '/' + encodeURIComponent(id)).then(function (r) { return snapOf(r && r.doc); }, function (e) {
          if (e.status === 404) return snapOf(undefined);   /* missing, deleted, or not revealed to a player */
          if (isNetErr(e) && npcs.loaded) return npcSnap(id);
          throw e;
        });
      },
      set: function (doc) { return npcWrite(id, 'PUT', doc, function () { npcs.docs[id] = clone(doc); }); },
      update: function (patch) { return npcWrite(id, 'PATCH', patch, function () { if (id in npcs.docs) deepMerge(npcs.docs[id], patch); }); },
      delete: function () { return npcWrite(id, 'DELETE', undefined, function () { delete npcs.docs[id]; }); },
      onSnapshot: function (cb, err) { return subscribe({ npcs: true, id: id, cb: cb, err: err }); }
    };
  }
  /* collection('npcs'): where / orderBy / limit over the cached cast, get(), onSnapshot(), doc(id) */
  function makeNpcQuery(q) {
    function next(change) { return makeNpcQuery({ order: q.order.concat(change.order || []), where: q.where.concat(change.where || []), limit: change.limit !== undefined ? change.limit : q.limit }); }
    var c = {
      orderBy: function (f, dir) { return next({ order: [{ field: f, dir: dir === 'desc' ? 'desc' : 'asc' }] }); },
      limit: function (n) { return next({ limit: n }); },
      where: function (f, op, v) {
        if (!OPS[op]) throw new Error('unsupported where operator: ' + op);
        return next({ where: [{ field: f, op: op, value: v }] });
      },
      get: function () {
        if ((running || mode === 'snapshot') && npcs.loaded) return Promise.resolve(querySnap(q, npcs.docs, npcSnap));
        return api('GET', '/' + NPCS).then(function (r) {
          var docs = {}; ((r && r.docs) || []).forEach(function (row) { if (!row.deleted && row.doc) docs[row.id] = row.doc; });
          return querySnap(q, docs, function (id) { return { id: id, exists: true, data: function () { return clone(docs[id]); }, metadata: { fromCache: false, hasPendingWrites: false } }; });
        }, function (e) {
          if (isNetErr(e) && npcs.loaded) return querySnap(q, npcs.docs, npcSnap);
          throw e;
        });
      },
      onSnapshot: function (cb, err) { return subscribe({ npcs: true, query: q, cb: cb, err: err }); }
    };
    c.path = NPCS; c.doc = npcRef;
    return c;
  }

  /* any other campaign document id: never exists, cannot be written */
  function missingRef(id) {
    function snap() { return { id: id, exists: false, data: function () { return undefined; }, metadata: { fromCache: false, hasPendingWrites: false } }; }
    function refuse() { return Promise.reject(new Error('unknown campaign document: ' + id)); }
    return {
      id: id, path: CAMPAIGN + '/' + id,
      get: function () { return Promise.resolve(snap()); },
      set: refuse, update: refuse, delete: refuse,
      onSnapshot: function (cb) {
        var live = true;
        setTimeout(function () { if (live) cb(snap()); }, 0);
        return function () { live = false; };
      }
    };
  }

  /* collection('campaign') as a query: always empty (the document is reached with .doc('main')) */
  function emptyQuery() {
    function snap() { return { docs: [], size: 0, empty: true, forEach: function () {} }; }
    var q = {
      orderBy: function () { return q; }, limit: function () { return q; }, where: function () { return q; },
      get: function () { return Promise.resolve(snap()); },
      onSnapshot: function (cb) {
        var live = true;
        setTimeout(function () { if (live) cb(snap()); }, 0);
        return function () { live = false; };
      }
    };
    return q;
  }

  function makeQuery(q) {
    function next(change) { return makeQuery({ order: q.order.concat(change.order || []), where: q.where.concat(change.where || []), limit: change.limit !== undefined ? change.limit : q.limit }); }
    return {
      orderBy: function (f, dir) { return next({ order: [{ field: f, dir: dir === 'desc' ? 'desc' : 'asc' }] }); },
      limit: function (n) { return next({ limit: n }); },
      where: function (f, op, v) {
        if (!OPS[op]) throw new Error('unsupported where operator: ' + op);
        return next({ where: [{ field: f, op: op, value: v }] });
      },
      /* from the live cache when the poller is running (or after an offline start), else one full read */
      get: function () {
        if ((running || mode === 'snapshot') && loaded) return Promise.resolve(querySnap(q, cache, docSnap));
        return api('GET', '/' + COLLECTION).then(function (r) {
          var docs = {}; ((r && r.docs) || []).forEach(function (row) { if (!row.deleted && row.doc) docs[row.id] = row.doc; });
          return querySnap(q, docs, function (id) { return { id: id, exists: true, data: function () { return clone(docs[id]); }, metadata: { fromCache: false, hasPendingWrites: false } }; });
        }, function (e) {
          if (isNetErr(e) && loaded) return querySnap(q, cache, docSnap);   /* offline: the last loaded copy */
          throw e;
        });
      },
      onSnapshot: function (cb, err) { return subscribe({ query: q, cb: cb, err: err }); }
    };
  }

  function collection(name) {
    if (name === CAMPAIGN) {
      var cq = emptyQuery();
      cq.path = CAMPAIGN; cq.doc = function (id) { return id === CAMPAIGN_ID ? campaignRef() : missingRef(String(id)); };
      return cq;
    }
    if (name === NPCS) return makeNpcQuery({ order: [], where: [], limit: null });
    if (name !== COLLECTION) throw new Error('unknown collection: ' + name);
    var c = makeQuery({ order: [], where: [], limit: null });
    c.path = COLLECTION; c.doc = docRef;
    return c;
  }
  var db = { collection: collection, doc: function (path) { var p = String(path).split('/'); return collection(p[0]).doc(p[1]); } };

  /* ---------- downloads ---------- */
  var TYPES = { json: 'application/json', svg: 'image/svg+xml', png: 'image/png', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv' };
  var downloads = {
    save: function (req) {
      return new Promise(function (resolve, reject) {
        req = req || {};
        if (!req.filename || req.data == null) { var e = new Error('a filename and data are required'); e.code = 'invalid'; reject(e); return; }
        var ext = String(req.filename).split('.').pop().toLowerCase();
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data], { type: TYPES[ext] || 'application/octet-stream' });
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = req.filename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
        resolve({ status: 'saved' });
      });
    }
  };

  /* ---------- rules: the rules wiki's corpus (RULES.md). Only the hosted build has it; the page caches the corpus itself
     (app/rules.js, IndexedDB), so these are plain calls on the API. A network failure rejects with `network: true`. ---------- */
  var rules = {
    /* GET /api/rules -> { version, updatedAt, count, books, entries }; opts.version: the cached version, answered
       { version, unchanged: true } (no entries) while it is still current */
    list: function (opts) { return api('GET', '/rules' + (opts && opts.version ? '?v=' + encodeURIComponent(opts.version) : '')); },
    /* POST /api/rules/import (GM): { book: 'b68' | 'bitd', entries: [{ slug, title, trail, keys, body, ord, src }], replace, part, of } */
    import: function (req) { return api('POST', '/rules/import', req || {}); },
    /* PUT / DELETE /api/rules/house/:slug (GM): a house rule written in the app */
    saveHouse: function (slug, entry) { return api('PUT', '/rules/house/' + encodeURIComponent(slug), entry || {}); },
    deleteHouse: function (slug) { return api('DELETE', '/rules/house/' + encodeURIComponent(slug)); }
  };

  /* ---------- gm: the GM tools (GM.md). GM only on the server (403 for anyone else); hosted build only. Plain calls
     on the API: nothing here is queued, put in the offline snapshot or written to localStorage, and none of it goes
     through the db layer. The GM page keeps its own copy of the pack (IndexedDB). ---------- */
  var qs = function (k, v) { return k + '=' + encodeURIComponent(v); };
  var gm = {
    /* GET /api/gm/pack -> { version, parts: { name: { version, src, updatedAt, bytes } } }; opts.version: the cached
       pack version, answered { version, unchanged: true } while it is still current */
    pack: function (opts) { return api('GET', '/gm/pack' + (opts && opts.version ? '?' + qs('v', opts.version) : '')); },
    /* GET /api/gm/pack?part=name -> { part, version, src, updatedAt, body }; opts.version -> { ..., unchanged: true } */
    packPart: function (name, opts) { return api('GET', '/gm/pack?' + qs('part', name) + (opts && opts.version ? '&' + qs('v', opts.version) : '')); },
    /* POST /api/gm/pack { part, src, body } -> { ok, part, version, bytes, unchanged, packVersion } */
    importPart: function (req) { return api('POST', '/gm/pack', req || {}); },
    /* DELETE /api/gm/pack?part=name -> { ok, part, packVersion } */
    removePart: function (name) { return api('DELETE', '/gm/pack?' + qs('part', name)); },
    /* GET /api/gm/state -> { doc, updatedAt }; PATCH merges (maps merge, null deletes) -> { doc, updatedAt } */
    state: function () { return api('GET', '/gm/state'); },
    patchState: function (patch) { return api('PATCH', '/gm/state', patch || {}); },
    /* GET /api/gm/display?seq=N&aseq=M -> { seq, display, updatedAt, ambient: { seq, doc, updatedAt } }. An ambient seq M that
       is still current gives ambient: { seq, unchanged: true }; both current -> { seq, unchanged: true, ambient: { seq, unchanged: true } }.
       seq alone (no aseq) is the old call: { seq, unchanged: true } while current, with the ambient ignored. */
    display: function (seq, aseq) {
      var q = [];
      if (seq !== undefined && seq !== null) q.push(qs('seq', seq));
      if (aseq !== undefined && aseq !== null) q.push(qs('aseq', aseq));
      return api('GET', '/gm/display' + (q.length ? '?' + q.join('&') : ''));
    },
    /* PUT /api/gm/display { kind: blank | dark | svg | npc | text, title, caption, svg | npcId | text } -> { seq, display, updatedAt } */
    setDisplay: function (d) { return api('PUT', '/gm/display', d || {}); },
    /* GET /api/gm/ambient -> { seq, doc, updatedAt }; PATCH merges at the top level (null deletes a key, skip: true bumps the
       counter) -> { seq, doc, updatedAt }. GM only: the table display gets the ambient through display() above. */
    ambient: function () { return api('GET', '/gm/ambient'); },
    patchAmbient: function (p) { return api('PATCH', '/gm/ambient', p || {}); },
    /* the table iPad's transcriber (GM.md "Listening"). GET /api/gm/stt -> { doc, updatedAt }: { want: on | off, session,
       speakers: { n: name }, status: { state, at, lines, error } }; PATCH merges (null deletes) -> { doc, updatedAt } */
    stt: function () { return api('GET', '/gm/stt'); },
    patchStt: function (p) { return api('PATCH', '/gm/stt', p || {}); },
    /* POST /api/gm/stt/token -> { token, expiresIn }: a short-lived Deepgram token (the key stays a Worker secret) */
    sttToken: function () { return api('POST', '/gm/stt/token', {}); },
    /* GET /api/gm/transcript?after=N | ?tail=N -> { lines: [{ seq, id, session, at, conn, speaker, kind, text }], last };
       POST { lines } -> { added, last } (a line's id makes a resend harmless) */
    transcript: function (o) { return api('GET', '/gm/transcript?' + (o && o.tail ? qs('tail', o.tail) : qs('after', o && o.after || 0))); },
    addTranscript: function (lines) { return api('POST', '/gm/transcript', { lines: lines || [] }); }
  };

  /* ---------- profile: the signed-in person's own display name (PATCH /api/me). A plain call: never queued, so it
     rejects with `network: true` while offline. Nobody can set another person's name. ---------- */
  var profile = {
    /* setName(name) -> Promise<{ id, email, name, role, campaign }> (the same shape as /api/me, `name` being what is now
       shown). name: trimmed server side, 1-40 characters, no < or >; '' or null clears it back to the sign-in name.
       Rejects with Error(api error string) and err.status 400 for a name the server refuses. On success the signed-in
       user (window.B68Runtime.me, user.me()) and the cached member names carry the new name. */
    setName: function (name) {
      return api('PATCH', '/me', { name: name === undefined || name === null ? null : String(name) }).then(function (m) {
        if (m && m.id && typeof m.name === 'string') {
          if (me && me.id === m.id) me.name = m.name;   /* the same object user.me() and B68Runtime.me read */
          if (membersById && membersById[m.id]) membersById[m.id].name = m.name;
          members = null;                                /* the next profiles() asks the server again */
          persistSoon();
        }
        return m;
      });
    }
  };

  /* ---------- window.claude ---------- */
  var uses = {};
  var makers = {
    user: function () { return loadMe().then(function (m) { return m ? makeUser(m) : null; }); },
    db: function () { return loadMe().then(function (m) { return m ? db : null; }); },
    downloads: function () { return Promise.resolve(downloads); }
  };
  window.claude = {
    use: function (name) {
      if (!makers[name]) return Promise.resolve(null);
      return uses[name] || (uses[name] = makers[name]());
    },
    rules: rules,
    gm: gm,
    profile: profile
  };

  /* ---------- installable: manifest, icons, home-screen metas, service worker (hosted build only) ----------
     Added from here so index.html stays the same page the artifact runs. The manifest is fetched with the
     Access cookie (crossorigin="use-credentials"), or Access would answer it with its sign-in redirect. */
  (function installable() {
    var d = document, head = d.head || (d.getElementsByTagName && d.getElementsByTagName('head')[0]);
    if (head && typeof d.createElement === 'function') {
      var add = function (tag, attrs, probe) {
        try {
          if (head.querySelector && head.querySelector(probe)) return;
          var el = d.createElement(tag);
          Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
          head.appendChild(el);
        } catch (e) {}
      };
      /* the Worker already puts a doctype, charset and this viewport in front of the page (worker/app.js); this is
         the fallback if the page ever arrives without them, so a phone does not lay it out 980 px wide */
      add('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, 'meta[name="viewport"]');
      add('link', { rel: 'manifest', href: 'manifest.webmanifest', crossorigin: 'use-credentials' }, 'link[rel="manifest"]');
      add('meta', { name: 'theme-color', content: '#14110e' }, 'meta[name="theme-color"]');
      add('link', { rel: 'icon', type: 'image/png', sizes: '192x192', href: 'icons/icon-192.png' }, 'link[rel="icon"]');
      add('link', { rel: 'apple-touch-icon', href: 'icons/apple-touch-icon.png' }, 'link[rel="apple-touch-icon"]');
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }, 'meta[name="apple-mobile-web-app-capable"]');
      add('meta', { name: 'mobile-web-app-capable', content: 'yes' }, 'meta[name="mobile-web-app-capable"]');
      add('meta', { name: 'apple-mobile-web-app-title', content: "Blades '68" }, 'meta[name="apple-mobile-web-app-title"]');
      add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }, 'meta[name="apple-mobile-web-app-status-bar-style"]');
    }
    var nav = window.navigator;
    if (!nav || !nav.serviceWorker || typeof nav.serviceWorker.register !== 'function') return;
    /* updateViaCache 'none': sw.js imports routes.js (the build stamp), and the update check must fetch that import fresh too */
    var register = function () { try { nav.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(function () {}); } catch (e) {} };
    if (d.readyState === 'complete' || typeof window.addEventListener !== 'function') register();
    else window.addEventListener('load', register);
  })();
})();
