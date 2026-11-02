// The show contract (suite W0.3): what the table display can be told to show beyond the four overlays that were there before
// (clock, npc, fx, text), and the lasting layers it can be told to hold. Plain ES module (no Cloudflare imports); it imports nothing from
// gm.js, so gm.js may import it.
//
// BRIEF BEATS are overlay kinds. They ride in the ambient document's single `overlay` ({ id, kind, ms, at, payload }), so they get what the
// overlay already has: the server's own expiry (at + ms, in liveAmbient), the lights-out rule, and a read-time join on every poll.
//   stamp { word (24), tone? ink|orange|blue|red }      spotted { text? (60), level? 1-3 }       keyturn { label (60), pc? (60) }
//   title { text (80), sub? (120) }                     wanted { level 0-4, heat? 0-9, siren? }  ring { text? (60) }
//   rolodex { npcIds [1-12] }  and  spotlight { npcId }   -- joined to their rows like an npc overlay: REVEALED NPCs only.
// LASTING LAYERS sit in the ambient document (`layers`, nested: band / scene / data) and stay until cleared:
//   band.phase pb|plan|score|after   band.security 0-4   band.faces [<=3 of { npcId } | { pcId }]   band.onair true
//   scene.filter flashback           scene.layout montage   scene.mode start|aftermath
//   data.countdown { to (epoch ms), label? (40) }   data.credits [npcId, <=30]   data.previously [npcId, <=12]
// SECRECY: an NPC id is kept only while that NPC is revealed (dropped when written, dropped again on every read), the served payload is
// rebuilt from named keys (never a spread of what is stored), and free text is scanned for hidden names by the handler when it is set.
import { HttpError, ID_RE, isPlainObject } from './http.js';

const TONES = ['ink', 'orange', 'blue', 'red'];
const REPORT_POSITIONS = ['controlled', 'risky', 'desperate'], REPORT_EFFECTS = ['limited', 'standard', 'great'];   // the action report card (B09 spine.stamp): report { position, effect, text? (100) }
export const SHOW_MS = { min: 1000, max: 180000 };
export const SHOW_NPC_MAX = { rolodex: 12, faces: 3, credits: 30, previously: 12 };

const bad = (m) => { throw new HttpError(400, m); };
function text(v, name, max, required) {
  if (v === undefined || v === null || v === '') { if (required) bad(name + ' is required'); return undefined; }
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) { if (required) bad(name + ' is required'); return undefined; }
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}
function whole(v, name, lo, hi, required) {
  if (v === undefined || v === null) { if (required) bad(name + ' is required'); return undefined; }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(name + ' must be a whole number from ' + lo + ' to ' + hi);
  return v;
}
function oneOf(v, name, list, required) {
  if (v === undefined || v === null) { if (required) bad(name + ' is required'); return undefined; }
  if (typeof v !== 'string' || !list.includes(v)) bad(name + ' must be one of ' + list.join(', '));
  return v;
}
function ids(v, name, max, required) {
  if (v === undefined || v === null) { if (required) bad(name + ' is required'); return undefined; }
  if (!Array.isArray(v)) bad(name + ' must be a list of ids');
  if (v.length > max) bad(name + ' holds at most ' + max + ' ids');
  v.forEach((x) => { if (typeof x !== 'string' || !ID_RE.test(x)) bad(name + ' holds a bad id'); });
  const out = [...new Set(v)];
  if (required && !out.length) bad(name + ' is required');
  return out;
}
const put = (o, k, v) => { if (v !== undefined) o[k] = v; return o; };

// kind -> payload builder (named keys only). npc: which join the kind needs ('list' = npcIds, 'one' = npcId).
export const SHOW_KINDS = {
  stamp: { build: (p) => put({ word: text(p.word, 'payload.word', 24, true) }, 'tone', oneOf(p.tone, 'payload.tone', TONES)) },
  spotted: { build: (p) => put(put({}, 'text', text(p.text, 'payload.text', 60)), 'level', whole(p.level, 'payload.level', 1, 3)) },
  keyturn: { build: (p) => put({ label: text(p.label, 'payload.label', 60, true) }, 'pc', text(p.pc, 'payload.pc', 60)) },
  title: { build: (p) => put({ text: text(p.text, 'payload.text', 80, true) }, 'sub', text(p.sub, 'payload.sub', 120)) },
  wanted: {
    build: (p) => {
      if (p.siren !== undefined && p.siren !== null && typeof p.siren !== 'boolean') bad('payload.siren must be true or false');
      const o = { level: whole(p.level, 'payload.level', 0, 4, true) };
      put(o, 'heat', whole(p.heat, 'payload.heat', 0, 9));
      if (p.siren === true) o.siren = true;
      return o;
    },
  },
  report: {
    build: (p) => put({ position: oneOf(p.position, 'payload.position', REPORT_POSITIONS, true), effect: oneOf(p.effect, 'payload.effect', REPORT_EFFECTS, true) }, 'text', text(p.text, 'payload.text', 100)),
  },
  ring: { build: (p) => put({}, 'text', text(p.text, 'payload.text', 60)) },
  rolodex: { npc: 'list', build: (p) => ({ npcIds: ids(p.npcIds, 'payload.npcIds', SHOW_NPC_MAX.rolodex, true) }) },
  spotlight: {
    npc: 'one',
    build: (p) => {
      if (typeof p.npcId !== 'string' || !ID_RE.test(p.npcId)) bad('payload.npcId is a bad id');
      return { npcId: p.npcId };
    },
  },
};
export const SHOW_KIND_IDS = Object.keys(SHOW_KINDS);
export const isShowKind = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(SHOW_KINDS, k);

/** The payload of a brief beat, rebuilt from named keys. 400 on anything out of bounds. Unknown keys are dropped. */
export function cleanShowPayload(kind, v) {
  if (!isShowKind(kind)) bad('overlay.kind is not a show kind');
  if (!isPlainObject(v)) bad('overlay.payload must be an object');
  return SHOW_KINDS[kind].build(v);
}

// ---- layers ----------------------------------------------------------------------------------------------------------------------
const FACE = (f) => {
  if (!isPlainObject(f)) bad('band.faces holds { npcId } or { pcId }');
  if (typeof f.npcId === 'string' && ID_RE.test(f.npcId)) return { npcId: f.npcId };
  if (typeof f.pcId === 'string' && ID_RE.test(f.pcId)) return { pcId: f.pcId };
  return bad('band.faces holds { npcId } or { pcId }');
};
export const LAYERS = {
  'band.phase': (v) => oneOf(v, 'band.phase', ['pb', 'plan', 'score', 'after'], true),
  'band.security': (v) => whole(v, 'band.security', 0, 4, true),
  'band.faces': (v) => {
    if (!Array.isArray(v) || !v.length) bad('band.faces must be a list of one to ' + SHOW_NPC_MAX.faces);
    if (v.length > SHOW_NPC_MAX.faces) bad('band.faces holds at most ' + SHOW_NPC_MAX.faces);
    return v.map(FACE);
  },
  'band.onair': (v) => { if (v !== true) bad('band.onair must be true (null clears it)'); return true; },
  'scene.filter': (v) => oneOf(v, 'scene.filter', ['flashback'], true),
  'scene.layout': (v) => oneOf(v, 'scene.layout', ['montage'], true),
  'scene.mode': (v) => oneOf(v, 'scene.mode', ['start', 'aftermath'], true),
  'data.countdown': (v) => {
    if (!isPlainObject(v)) bad('data.countdown must be { to, label? }');
    const o = { to: whole(v.to, 'data.countdown.to', 1, 8.64e15, true) };
    return put(o, 'label', text(v.label, 'data.countdown.label', 40));
  },
  'data.credits': (v) => ids(v, 'data.credits', SHOW_NPC_MAX.credits, true),
  'data.previously': (v) => ids(v, 'data.previously', SHOW_NPC_MAX.previously, true),
};
export const LAYER_PATHS = Object.keys(LAYERS);

/** One layer op of a PATCH body: { path, value } (value null clears that path) -> the cleaned { path, value }. */
export function cleanLayerOp(op) {
  if (!isPlainObject(op)) bad('layer must be { path, value }');
  if (typeof op.path !== 'string' || !LAYER_PATHS.includes(op.path)) bad('layer.path must be one of ' + LAYER_PATHS.join(', '));
  if (!('value' in op)) bad('layer.value is required (null clears the layer)');
  return { path: op.path, value: op.value === null ? null : LAYERS[op.path](op.value) };
}

/** The texts of a cleaned overlay patch or layer op that a reader will see as words: scanned for hidden names by the handler. */
export function showTexts(ov, layer) {
  const out = [];
  const add = (o) => { if (isPlainObject(o)) for (const v of Object.values(o)) if (typeof v === 'string') out.push(v); };
  if (ov && isShowKind(ov.kind) && ov.payload) add(ov.payload);
  if (layer && isPlainObject(layer.value) && !Array.isArray(layer.value)) add(layer.value);
  return out;
}

/** The NPC ids a cleaned overlay or layer op names. */
export function npcIdsOf(ov, layer) {
  const out = [];
  if (ov && isShowKind(ov.kind) && ov.payload) {
    if (SHOW_KINDS[ov.kind].npc === 'list') out.push(...(ov.payload.npcIds || []));
    if (SHOW_KINDS[ov.kind].npc === 'one' && ov.payload.npcId) out.push(ov.payload.npcId);
  }
  if (layer) {
    if (layer.path === 'band.faces' && Array.isArray(layer.value)) layer.value.forEach((f) => { if (f.npcId) out.push(f.npcId); });
    if ((layer.path === 'data.credits' || layer.path === 'data.previously') && Array.isArray(layer.value)) out.push(...layer.value);
  }
  return out;
}

const FIG = ['v', 'figure', 'shape', 'build', 'heightIn', 'skin', 'age', 'seed', 'body', 'bigLeg', 'pose', 'head', 'heads', 'face', 'hair', 'jewelry', 'jewellery', 'outfit', 'props', 'companion'];
function drawing(spec) {
  if (!isPlainObject(spec)) return null;
  const out = {};
  for (const k of FIG) if (k in spec) out[k] = spec[k];
  return out;
}
const s = (v) => (typeof v === 'string' ? v : '');

/** { id: card } for the ids that are live in this campaign and revealed: ONE read, none when there are no ids. Never description or gmNotes. */
export async function revealedCards(db, campaign, idList, withSpec) {
  const list = [...new Set(idList.filter((x) => typeof x === 'string' && ID_RE.test(x)))].slice(0, 60);
  if (!list.length) return {};
  const marks = list.map((_, i) => '?' + (i + 2)).join(',');
  const rows = await db.prepare('SELECT id, doc FROM npcs WHERE campaign = ?1 AND deleted = 0 AND id IN (' + marks + ')').bind(campaign, ...list).all();
  const out = {};
  for (const r of (rows && rows.results) || []) {
    let d = null;
    try { d = JSON.parse(r.doc); } catch (_) { d = null; }
    if (!isPlainObject(d) || d.revealed !== true) continue;
    out[r.id] = { npcId: r.id, name: s(d.name), alias: s(d.alias), role: s(d.role), faction: s(d.faction) };
    if (withSpec) out[r.id].spec = drawing(d.spec);
    if (!out[r.id].name) delete out[r.id];
  }
  return out;
}

function liveIds(stored) {
  const o = stored.overlay, l = stored.layers, out = [];
  if (isPlainObject(o) && isShowKind(o.kind) && isPlainObject(o.payload)) {
    if (SHOW_KINDS[o.kind].npc === 'list' && Array.isArray(o.payload.npcIds)) out.push(...o.payload.npcIds);
    if (SHOW_KINDS[o.kind].npc === 'one') out.push(o.payload.npcId);
  }
  if (isPlainObject(l)) {
    if (isPlainObject(l.band) && Array.isArray(l.band.faces)) l.band.faces.forEach((f) => { if (isPlainObject(f)) out.push(f.npcId); });
    if (isPlainObject(l.data)) for (const k of ['credits', 'previously']) if (Array.isArray(l.data[k])) out.push(...l.data[k]);
  }
  return out;
}

/**
 * The read-time join (GET /api/gm/display, every poll). Takes the stored overlay and layers (either may be null) and returns what may be served:
 * { overlay, layers } -- a brief beat rebuilt from named keys (one that no longer validates is left out) and, for rolodex and spotlight, joined to
 * the NPCs that are revealed NOW (none left: the overlay is left out); layers rebuilt and joined the same way (a face, credit or "previously"
 * line for an NPC who is hidden is dropped; a layer left empty is left out). ONE batched read, and none unless an NPC is named. An overlay of an
 * old kind passes through untouched. `layers` is null when there is nothing to serve, so the caller can leave the key off.
 */
export async function joinShows(db, campaign, overlay, layers) {
  const ov = isPlainObject(overlay) && isShowKind(overlay.kind) ? overlay : null;
  const lay = isPlainObject(layers) ? layers : null;
  if (!ov && !lay) return { overlay: overlay || null, layers: null };
  // layers are rebuilt through the same checks as a write; a stored value that no longer passes is left out
  const clean = {};
  if (lay) {
    for (const group of ['band', 'scene', 'data']) {
      if (!isPlainObject(lay[group])) continue;
      for (const key of Object.keys(lay[group])) {
        const path = group + '.' + key;
        if (!LAYERS[path]) continue;
        try { const v = LAYERS[path](lay[group][key]); (clean[group] = clean[group] || {})[key] = v; } catch (_) { /* a stale value */ }
      }
    }
  }
  let payload = null;
  if (ov) { try { payload = cleanShowPayload(ov.kind, ov.payload); } catch (_) { payload = null; } }
  const names = liveIds({ overlay: payload ? { kind: ov.kind, payload } : null, layers: clean });
  const cards = names.length ? await revealedCards(db, campaign, names, true) : {};
  const plain = (c) => ({ npcId: c.npcId, name: c.name, role: c.role });
  const outLay = {};
  const add = (g, k, v) => { (outLay[g] = outLay[g] || {})[k] = v; };
  for (const g of Object.keys(clean)) {
    for (const k of Object.keys(clean[g])) {
      const v = clean[g][k];
      if (g === 'band' && k === 'faces') {
        const faces = v.map((f) => (f.npcId ? (cards[f.npcId] ? { npcId: f.npcId, name: cards[f.npcId].name, role: cards[f.npcId].role, spec: cards[f.npcId].spec } : null) : f)).filter(Boolean);
        if (faces.length) add(g, k, faces);
      } else if (g === 'data' && (k === 'credits' || k === 'previously')) {
        const rows = v.map((id) => (cards[id] ? plain(cards[id]) : null)).filter(Boolean);
        if (rows.length) add(g, k, rows);
      } else add(g, k, v);
    }
  }
  let served = overlay || null;
  if (ov) {
    if (!payload) served = null;
    else {
      const base = { id: ov.id, kind: ov.kind, ms: ov.ms, at: ov.at, age: ov.age, auto: ov.auto };
      let p = payload;
      if (SHOW_KINDS[ov.kind].npc === 'list') {
        const list = payload.npcIds.map((id) => cards[id]).filter(Boolean);
        p = list.length ? { npcs: list } : null;
      } else if (SHOW_KINDS[ov.kind].npc === 'one') p = cards[payload.npcId] ? { npc: cards[payload.npcId] } : null;
      if (p) { served = base; served.payload = p; for (const k of Object.keys(served)) if (served[k] === undefined) delete served[k]; } else served = null;
    }
  }
  return { overlay: served, layers: Object.keys(outLay).length ? outLay : null };
}

/** Apply a cleaned layer op to a stored `layers` object (a fresh object; null when it ends empty). */
export function applyLayer(layers, op) {
  const next = isPlainObject(layers) ? JSON.parse(JSON.stringify(layers)) : {};
  const [g, k] = op.path.split('.');
  if (op.value === null) {
    if (next[g]) { delete next[g][k]; if (!Object.keys(next[g]).length) delete next[g]; }
  } else (next[g] = next[g] || {})[k] = op.value;
  return Object.keys(next).length ? next : null;
}

/** Is a stored overlay with this id still running at nowMs? (Used by the once-by-id check: an expired one does not block a fresh show.) */
export function overlayRunning(o, nowMs) {
  if (!isPlainObject(o)) return false;
  const at = typeof o.at === 'string' ? Date.parse(o.at) : NaN;
  if (!Number.isFinite(at) || !Number.isInteger(o.ms)) return true;
  return nowMs - at < o.ms;
}
