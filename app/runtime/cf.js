/* Hosted runtime adapter (Cloudflare Pages + Access + D1).
   Defines window.claude.use('user' | 'db' | 'downloads') on top of the JSON API in functions/
   (see HOSTING.md) so the page runs unchanged outside the claude.ai artifact.
   Inside the artifact window.claude already exists and this file does nothing. */
(function () {
  'use strict';
  if (window.claude) return;
  /* only on the hosted site: from file:// (local checks, a saved copy) there is no API, so define nothing */
  var proto = window.location && window.location.protocol;
  if (proto !== 'http:' && proto !== 'https:') return;

  var COLLECTION = 'characters';
  var SIGNED_OUT = 'signed out: reload the page to sign in again';
  var CONFLICT_RETRIES = 2;      /* a write answered 409 (the row kept changing) is sent again this many times */
  var MEMBERS_TTL_MS = 60000;

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
  function signedOutError() { var e = new Error(SIGNED_OUT); e.code = 'signed_out'; e.status = 401; return e; }

  /* ---------- the API ---------- */
  var signedOut = false;       /* the Access session ended: stop polling, refuse writes */
  var onSignedOut = null;      /* set by the db layer */

  /* fetch JSON. Rejects with Error(api error string). A 401, or anything that looks like the Access
     login page instead of our API (a followed or opaque redirect, a non-JSON body), marks the session signed out. */
  function api(method, path, body) {
    if (signedOut) return Promise.reject(signedOutError());
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/api' + path, opts).then(function (res) {
      var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (res.status === 401 || res.redirected || res.type === 'opaqueredirect' || ct.indexOf('json') < 0) {
        if (!signedOut) { signedOut = true; if (onSignedOut) onSignedOut(); }
        throw signedOutError();
      }
      return res.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!res.ok) { var err = new Error((j && j.error) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
        return j;
      });
    });
  }

  /* ---------- user ---------- */
  var meP = null;
  /* /api/me once; null when not signed in or unreachable */
  function loadMe() {
    if (!meP) meP = api('GET', '/me').then(function (m) { return m && m.id ? m : null; }, function () { return null; })
      .then(function (m) { window.B68Runtime = { kind: 'cloudflare', me: m }; return m; });   /* me carries role, for the header */
    return meP;
  }

  var members = null;          /* { at, promise } */
  function loadMembers() {
    if (members && Date.now() - members.at < MEMBERS_TTL_MS) return members.promise;
    var p = api('GET', '/members').then(function (r) {
      var byId = {}; ((r && r.members) || []).forEach(function (m) { byId[m.id] = m; }); return byId;
    });
    members = { at: Date.now(), promise: p };
    p.catch(function () { members = null; });   /* do not cache a failure */
    return p;
  }

  function makeUser(m) {
    var gm = m.role === 'gm';
    return {
      id: function () { return Promise.resolve(m.id); },
      me: function () { return Promise.resolve({ id: m.id, name: m.name || '', email: m.email || m.id, isOwner: gm, canEdit: gm }); },
      can: function (name) { return Promise.resolve(name === 'data.write'); },
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
  var listeners = [];          /* { id?, query?, cb, err } */
  var loaded = false;          /* the first full load has happened since start */
  var running = false, inflight = false, again = false, timer = null;
  var since = null, epoch = 0, errored = false;

  function docSnap(id) {
    var d = cache[id];
    return { id: id, exists: d !== undefined, data: function () { return clone(d); }, metadata: { fromCache: false, hasPendingWrites: !!pending[id] } };
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

  /* tell listeners: doc listeners only when their document changed (or `all`), query listeners on any change */
  function notify(changed, all) {
    listeners.slice().forEach(function (l) {
      if (listeners.indexOf(l) < 0) return;
      try {
        if (l.id !== undefined) { if (all || changed[l.id]) l.cb(docSnap(l.id)); }
        else if (all || Object.keys(changed).length) l.cb(querySnap(l.query, cache, docSnap));
      } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  function notifyErr(e) {
    listeners.slice().forEach(function (l) { if (l.err) { try { l.err(e); } catch (x) {} } });
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
    var full = !loaded, at = epoch;
    api('GET', '/' + COLLECTION + (full ? '' : '?since=' + encodeURIComponent(since)))
      .then(function (r) {
        /* a write started or finished while this poll was out: its view may be stale, ask again */
        if (at !== epoch) { again = true; return; }
        errored = false;
        if (running) applyServer(r || {}, full);
      }, function (e) {
        if (signedOut) return;                        /* reported by onSignedOut */
        if (!errored) { errored = true; notifyErr(e); } /* surface once; retry on the next tick */
      })
      .then(function () {
        inflight = false;
        if (again) { again = false; schedule(0); } else schedule();
      });
  }
  function start() { if (running) return; running = true; loaded = false; errored = false; epoch++; schedule(0); }   /* epoch++: drop a poll left over from before a stop */
  function stop() { running = false; loaded = false; again = false; clearTimeout(timer); timer = null; }
  function pollSoon() { if (!running) return; if (inflight) again = true; else schedule(0); }

  onSignedOut = function () { stop(); notifyErr(signedOutError()); };
  if (document.addEventListener) document.addEventListener('visibilitychange', function () {
    if (running && !inflight) schedule(document.hidden ? null : 0);
  });

  function subscribe(l) {
    listeners.push(l);
    if (signedOut) { setTimeout(function () { if (l.err && listeners.indexOf(l) >= 0) l.err(signedOutError()); }, 0); }
    else if (running && loaded) {
      setTimeout(function () { if (listeners.indexOf(l) >= 0) l.cb(l.id !== undefined ? docSnap(l.id) : querySnap(l.query, cache, docSnap)); }, 0);
    }
    start();
    var done = false;
    return function unsubscribe() {
      if (done) return; done = true;
      var i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1);
      if (!listeners.length) stop();
    };
  }

  /* an own write: update the cache now, send it, take the server's version, then poll */
  function write(id, method, body, local) {
    if (signedOut) return Promise.reject(signedOutError());
    var ch = {}; ch[id] = true;
    pending[id] = (pending[id] || 0) + 1; epoch++;
    local(); notify(ch);
    var path = '/' + COLLECTION + '/' + encodeURIComponent(id);
    function settle() { epoch++; if (!--pending[id]) delete pending[id]; }
    function send(n) {
      return api(method, path, body).catch(function (e) {
        if (e.status !== 409 || n >= CONFLICT_RETRIES) throw e;
        return new Promise(function (ok) { setTimeout(ok, 150 * (n + 1)); }).then(function () { return send(n + 1); });
      });
    }
    return send(0).then(function (r) {
      settle();
      if (!pending[id]) {
        if (method === 'DELETE') { delete cache[id]; delete stamp[id]; }
        else if (r && r.doc) { cache[id] = r.doc; stamp[id] = r.doc.updatedAt || ''; }
        notify(ch);
      }
      pollSoon();
    }, function (e) {
      settle();
      if (running && !signedOut) { loaded = false; pollSoon(); }   /* resync from the server */
      throw e;
    });
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

  function makeQuery(q) {
    function next(change) { return makeQuery({ order: q.order.concat(change.order || []), where: q.where.concat(change.where || []), limit: change.limit !== undefined ? change.limit : q.limit }); }
    return {
      orderBy: function (f, dir) { return next({ order: [{ field: f, dir: dir === 'desc' ? 'desc' : 'asc' }] }); },
      limit: function (n) { return next({ limit: n }); },
      where: function (f, op, v) {
        if (!OPS[op]) throw new Error('unsupported where operator: ' + op);
        return next({ where: [{ field: f, op: op, value: v }] });
      },
      /* from the live cache when the poller is running, else one full read */
      get: function () {
        if (running && loaded) return Promise.resolve(querySnap(q, cache, docSnap));
        return api('GET', '/' + COLLECTION).then(function (r) {
          var docs = {}; ((r && r.docs) || []).forEach(function (row) { if (!row.deleted && row.doc) docs[row.id] = row.doc; });
          return querySnap(q, docs, function (id) { return { id: id, exists: true, data: function () { return clone(docs[id]); }, metadata: { fromCache: false, hasPendingWrites: false } }; });
        });
      },
      onSnapshot: function (cb, err) { return subscribe({ query: q, cb: cb, err: err }); }
    };
  }

  function collection(name) {
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
    }
  };
})();
