// Unit test for the Shortcuts card (K1, app/gm/shortcuts.js): the card's TRUTH. The card is one array (SECTIONS) that the renderer draws and this test reads:
//   - every "Blade, …" example and every typed /command on it goes through the app's real parsers (app/cue.js with the verbs the page registers:
//     gm/cue-grammar.js, then gm/cue-stack.js's "go"; B68Cue.fromTyped for a /command) and must come out as the verb the card says; each action then passes
//     the Worker's own validateActions as a parsed cue; the "iPad mic only" lines are the iPad's (display/onair.js detect) and the cue lane does nothing with them
//   - every cue line goes through gm/cue-stack.js parse under "## Cues" and comes out as the kind the card says
//   - every "Blade, …" anywhere in the card's words is one of those; the lines the card says do NOT work do not (so "Blade, music …" stays off the card until it works)
//   - every key on the card is one the page's key handler handles (gm-page.js keyAction, or the named handler outside it), and every key keyAction handles is on the card
//   - the markup: every row drawn, nothing unescaped, the {fill-in} parts as <var>; the sheet opens, closes and is the one Esc's
// Invented names only (the Pelican Rooms; Nell Arbuthnot, Ray Okonjo, Tam Petrakis; Mabel Quist, Dov Kessler, Ada Vell, Lotte Brand). No network, no model.
//   node checks/runtime/gm-shortcuts.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const app = (...p) => path.join(ROOT, 'app', ...p);
const GP = require(app('gm-page.js'))._pure;                 // keyAction: the page's key handler, pure
const V = require(app('cue-verbs.js'));
const Cue = require(app('cue.js'));
const G = require(app('gm', 'cue-grammar.js'));
const CS = require(app('gm', 'cue-stack.js'));
const On = require(app('display', 'onair.js'));
const Esc = require(app('gm', 'esc.js'));
globalThis.self = globalThis;                                // cue-grammar reads "flashback 2"'s Stress through self.B68GmMapFlashback, as in a browser
globalThis.B68GmMapFlashback = require(app('gm', 'map-flashback.js'));
const SC = require(app('gm', 'shortcuts.js'));
const hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);
const SRC = { page: fs.readFileSync(app('gm-page.js'), 'utf8'), panel: fs.readFileSync(app('gm', 'assist-panel.js'), 'utf8') };

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* the verbs as the page registers them: the strict grammar first (b09Mount), then the cue stack's "go" (csMount), every switch on (features.js: all on) */
V.reset();
G.create({ feature: () => true, cueVerbs: () => V }).register();
CS.create({ feature: () => true, cueVerbs: () => V, grammar: () => G, grammarOn: () => true, note: () => null, doc: () => ({}) }).register();
/* the live table the cue lane parses against (cogmLive's shape) */
const LIVE = {
  clocks: [{ id: 'c-alarm', name: 'Alarm', size: 6, filled: 1, hidden: true }],
  pcs: [{ id: 'pc-nell', name: 'Nell Arbuthnot', alias: '' }, { id: 'pc-ray', name: 'Ray Okonjo', alias: '' }, { id: 'pc-tam', name: 'Tam Petrakis', alias: '' }],
  npcs: [], night: true, rooms: ['Cellar', 'Bar', 'Kitchen'], crew: {}, lastClock: 'c-alarm'
};
const STATE = hands.cleanState({ clocks: LIVE.clocks.map(({ id, name, size, filled, hidden }) => ({ id, name, size, filled, hidden })), npcs: [], pcs: LIVE.pcs.map(({ id, name }) => ({ id, name })) });

const sayRows = SC.rows('say'), keyRows = SC.rows('key'), lineRows = SC.rows('line');
/* every example the card prints: the lines, and each line's typed /command (drawn after what it does), held to the same want */
const examples = sayRows.flatMap((r) => r.say.map((s) => ({ r, s, how: r.how, text: SC.plain(s) })).concat(r.typed ? [{ r, s: r.typed, how: 'typed', text: SC.plain(r.typed) }] : []));
const strip = (a) => { const o = { ...a }; delete o.quote; return o; };
/* what a "Blade, …" line (or a typed /command) does in the cue lane: the sentence the lane parses, and its parse */
function lane(text) {
  const typed = Cue.fromTyped(text);
  const sentence = typed && typed.text ? typed.text : text;
  return { typed, sentence, res: Cue.parse(sentence, LIVE) };
}
function wants(a, want) { return Object.keys(want).every((k) => a[k] === want[k]); }

await test('the card is one array of sections; each row is a known kind with what it does; the examples have fill-ins that the parser never sees', () => {
  assert.ok(Array.isArray(SC.SECTIONS) && SC.SECTIONS.length >= 6);
  assert.deepEqual(SC.SECTIONS.map((s) => s.id), ['keys', 'esc', 'music', 'clocks', 'blade', 'box', 'blade2', 'cues'], 'keys, Esc, music, clocks, the Blade lines, the keys inside a box, cue lines');
  assert.deepEqual(SC.SECTIONS.map((s) => s.col), [1, 1, 2, 2, 3, 3, 4, 4], 'four stacks on a laptop, in card order');
  const ids = new Set();
  for (const s of SC.SECTIONS) {
    assert.ok(!ids.has(s.id) && s.title && Array.isArray(s.rows) && s.rows.length, s.id); ids.add(s.id);
    for (const r of s.rows) {
      assert.ok(['key', 'say', 'line', 'term'].includes(r.k), s.id + ': ' + JSON.stringify(r));
      assert.ok(typeof r.does === 'string' && r.does.trim().length > 3, s.id + ': every row says what it does');
      if (r.k === 'key') { assert.ok(r.keys.length && r.hits.length >= r.keys.length - 1, 'a key row has a press for its keys: ' + r.keys.join(' ')); }
      if (r.k === 'say') { assert.ok(Array.isArray(r.say) && r.say.length && ['both', 'typed', 'mic'].includes(r.how) && r.want, JSON.stringify(r)); }
      if (r.k === 'line') assert.ok(typeof r.line === 'string' && r.want, JSON.stringify(r));
    }
  }
  assert.equal(SC.plain('Blade, tick {Alarm} {two}'), 'Blade, tick Alarm two');
  assert.deepEqual(SC.rows().length, SC.SECTIONS.reduce((n, s) => n + s.rows.length, 0));
});

await test('every "Blade, …" example on the card parses (the real cue.js with the registered verbs) to the verb the card says, and the Worker takes it as a parsed cue', () => {
  let n = 0;
  for (const { r, s, how, text } of examples) {
    if (how === 'mic') continue;
    const { typed, sentence, res } = lane(text);
    const at = r.sec + ': "' + s + '"';
    if (how === 'typed') assert.ok(/^\//.test(text) && typed && typed.text && !typed.unknown, at + ' is a typed /command the Ask box maps (fromTyped)');
    else assert.deepEqual(typed, { text }, at + ': typed in the Ask box it goes as it is');
    assert.ok(Cue.find(sentence, LIVE), at + ': the lane finds a cue in it');
    assert.equal(res.refused, null, at + ' refused: ' + res.refused);
    assert.equal(res.missing, null, at + ' missing: ' + res.missing);
    assert.equal(res.actions.length, 1, at + ': one action');
    const a = res.actions[0];
    assert.ok(wants(a, r.want), at + ' -> ' + JSON.stringify(strip(a)) + ', the card says ' + JSON.stringify(r.want));
    const v = hands.validateActions([a], { state: STATE, lines: [{ id: 'l-cue', kind: 'line', text: sentence }], cue: { parsed: true, cueLineId: 'l-cue' } });
    assert.equal(v.dropped.length, 0, at + ': the Worker dropped it: ' + JSON.stringify(v.dropped));
    assert.equal(v.actions.length, 1, at); assert.equal(v.actions[0].type, a.type, at);
    n++;
  }
  assert.ok(n >= 25, 'the card carries the lane\'s verbs (' + n + ' examples)');
});

await test('the card holds every verb the cue lane takes today: make, tick, mark-as-tick, fill, clear, rename, undo, note, loose end, name, move, and each registered verb', () => {
  const said = examples.filter((e) => e.how !== 'mic').map((e) => lane(e.text).res.actions[0]);
  const has = (pred) => said.some((a) => a && pred(a));
  for (const t of ['clock_add', 'clock_tick', 'npc_add', 'rename', 'undo', 'pc_move']) assert.ok(has((a) => a.type === t), 'the card shows ' + t);
  for (const b of ['moment', 'loose_end', 'name']) assert.ok(has((a) => a.type === 'capture' && a.bucket === b), 'the card shows the ' + b + ' capture');
  assert.ok(has((a) => a.type === 'clock_tick' && a.by < 0), 'clear (a tick back)'); assert.ok(has((a) => a.type === 'clock_tick' && a.by > 1), 'a tick of more than one');
  const verbs = new Set(said.filter((a) => a && a.type === 'cue_do').map((a) => a.verb));
  for (const v of hands.CUE_DO_VERBS) assert.ok(verbs.has(v), 'the card shows the cue verb ' + v);
  const heard = new Set(examples.filter((e) => e.how !== 'mic').map((e) => (lane(e.text).res.cue || {}).verb));
  /* the grammar's "go" word sits under the cue stack's "go" phrase on the page (cuego hands "go to planning" to the grammar's parseGo): its cue_do verb is the proof */
  for (const v of V.list()) assert.ok(heard.has(v.id) || verbs.has(v.id), 'every registered verb has a line on the card: ' + v.id);
  assert.ok(heard.has('cuego'), 'the cue stack\'s "go" is what the page hears');
  const typedForms = examples.filter((e) => e.how === 'typed').map((e) => e.text.split(/\s+/)[0]).sort();
  assert.deepEqual(typedForms, ['/clock', '/note', '/npc', '/tick', '/undo'], 'every typed /command fromTyped maps: ' + typedForms.join(' '));
  assert.ok(Cue.fromTyped('/nonsense x').unknown, 'and only those: another /word is unknown');
});

await test('the iPad-mic lines are the iPad\'s own (B68OnAir.detect), and the cue lane does nothing with them (typed, they would do nothing: the card says say it)', () => {
  const mic = examples.filter((e) => e.how === 'mic');
  assert.deepEqual(mic.map((e) => e.text), ['Blade, off the record', 'Blade, back on']);
  for (const { r, text } of mic) {
    assert.equal(On.detect(text), r.want.onair, text);
    const { res } = lane(text); assert.equal(res.actions.length, 0, text + ': no action in the cue lane');
  }
});

await test('the lines the card says do NOT work do not: "Blade, music …" has no verb today (when one lands, this fails and the card gets the line), and show/sheet are refused', () => {
  const nots = SC.rows('term').filter((r) => r.not);
  assert.ok(nots.length >= 2);
  for (const r of nots) for (const t of r.not) {
    const { res } = lane(t);
    assert.equal(res.actions.length, 0, '"' + t + '" acts: ' + JSON.stringify(res.actions.map(strip)));
    assert.ok(!On.detect(t), t + ' is not an iPad line either');
  }
  for (const t of ['Blade, music tension', 'Blade, music action', 'Blade, tension', 'Blade, play the action music', 'Blade, music off']) {
    assert.equal(lane(t).res.actions.length, 0, t + ' does nothing today');
  }
  assert.ok(SC.rows('term').some((r) => r.sec === 'music' && r.not && r.not.some((t) => /music/i.test(t))), 'the Music section says so');
});

await test('no "Blade, …" anywhere in the card\'s words but those checked: titles, notes and what-it-does lines included', () => {
  const words = SC.text();
  const said = new Set(examples.map((e) => e.text));
  const found = [...words.matchAll(/Blade, ([^”"\n—]+)/g)].map((m) => ('Blade, ' + m[1]).trim()).filter((t) => !/^Blade, …/.test(t));
  assert.ok(found.length >= 20, 'found ' + found.length);
  for (const t of found) {
    const ok = said.has(t) || (lane(t).res.actions.length === 1 && !lane(t).res.refused);
    assert.ok(ok, 'the card says "' + t + '" and it is not a checked example');
  }
  assert.ok(/Blade, go/.test(SC.SECTIONS.find((s) => s.id === 'cues').note), 'the cue lines\' note names "Blade, go" (it is the lane\'s fire)');
});

await test('every cue line on the card parses under "## Cues" (gm/cue-stack.js parse) as the kind the card says; one line per kind the grammar has', () => {
  for (const r of lineRows) {
    const p = CS.parse('## Cues\n' + SC.plain(r.line));
    if (r.want.safe) { assert.equal(p.safe, r.want.safe, r.line); assert.equal(p.cues.length, 0); continue; }
    assert.equal(p.cues.length, 1, r.line + ' skipped: ' + JSON.stringify(p.skipped));
    assert.equal(p.cues[0].kind, r.want.kind, r.line);
  }
  const kinds = lineRows.filter((r) => r.want.kind).map((r) => r.want.kind).sort();
  assert.deepEqual(kinds, CS.KINDS.slice().sort(), 'every kind the cue grammar takes, once');
  /* the whole section as the card prints it, in order, is one valid ## Cues */
  const all = CS.parse('## Cues\n' + lineRows.map((r) => SC.plain(r.line)).join('\n'));
  assert.equal(all.cues.length, CS.KINDS.length); assert.deepEqual(all.skipped, []); assert.equal(all.safe, 'testcard');
  assert.equal(CS.parse('## Cues\n5. music: tension').cues[0].arg, 'tension');
  for (const w of ['action', 'tension', 'calm', 'auto', 'off']) assert.equal(CS.parse('## Cues\n1. music: ' + w).cues.length, 1, 'music: ' + w + ' (the card lists it)');
});

/* ---------- the keys ---------- */
function press(h) { return { key: h.key, ctrlKey: !!h.ctrl, shiftKey: !!h.shift, altKey: false, metaKey: false, typing: false }; }
function body(src, start, end) { const i = src.indexOf(start); assert.ok(i >= 0, 'found ' + start); const j = src.indexOf(end, i + start.length); assert.ok(j > i, 'found the end of ' + start); return src.slice(i, j); }
const onKey = body(SRC.page, 'function onKey(ev) {', '\n  function toggleFocus');
const runViewKey = body(SRC.page, 'function runViewKey(ev) {', '\n  }\n');
const panelKey = body(SRC.panel, 'function onKey(ev) {', '\n    }\n');
const VIA = {
  /* GO: the cue stack's key(), the real code, with one cue in standby */
  go: (h) => {
    const note = { id: 'n-pelican', title: 'Pelican Rooms night', blocks: [{ k: 'md', src: '## Cues\n1. scene: tram' }] };
    const fired = [];
    const c = CS.create({ feature: () => true, note: () => note, doc: () => ({}), patch: () => true, now: () => 1e6, toast: () => {}, log: () => {}, scene: async (id) => { fired.push(id); return true; },
      show: async () => ({}), reveal: async () => ({ ok: true }), phase: async () => true, ambient: () => null, panic: async () => true, resume: async () => ({}), cueSlot: () => null });
    const ev = { key: h.key, target: { tagName: 'BODY' }, preventDefault() {} };
    return c.key(ev, { querySelector: () => null }) === true && fired.length === 1 && onKey.includes('S.cs.key(ev, document)');
  },
  'ctrl-k': () => /\(ev\.ctrlKey \|\| ev\.metaKey\) && !ev\.altKey && str\(ev\.key\)\.toLowerCase\(\) === 'k'\) \{[^}]*findOpen\(\)/.test(onKey),
  site: (h) => onKey.includes('if (runViewKey(ev)) return;') && /k !== 'ArrowRight' && k !== 'ArrowLeft'/.test(runViewKey) &&
    (h.shift ? /ev\.shiftKey\) S\.rv\.jump\(\)/.test(runViewKey) : h.key === 'ArrowRight' ? /S\.rv\.step\(1\)/.test(runViewKey) : /S\.rv\.step\(-1\)/.test(runViewKey)),
  panel: (h) => (h.key === 'u' ? /kl === 'u'\) \{[^}]*undoNewest\(\)/ : /kl === 'j' \|\| kl === 'k'\) \{[^}]*moveFocus/).test(panelKey) && /\.contains\(ev\.target\) && !ev\.ctrlKey[^\n]*\/\^\[jku\]\$\/i/.test(onKey),
  find: (h) => (h.key === 'Enter' ? /ev\.key === 'Enter' && tg && tg\.id === 'gm-find-q'\) \{[^}]*findGo/ : /if \(findOn\(\)\) \{\s*if \(ev\.key === 'ArrowDown' \|\| ev\.key === 'ArrowUp'\)/).test(onKey)
};

await test('every key on the card is one the page handles: keyAction answers what the card says, or the named handler outside it has that key', () => {
  let n = 0;
  for (const r of keyRows) for (const h of r.hits) {
    const at = r.sec + ' [' + r.keys.join(' ') + '] ' + JSON.stringify(h);
    if (h.act) {
      assert.deepEqual(GP.keyAction(press(h)), h.act, at);
      const typed = GP.keyAction({ ...press(h), typing: true });
      if (h.act.type === 'esc') assert.deepEqual(typed, { type: 'esc' }, at + ': Esc in a field leaves it (the one Esc)');
      else assert.equal(typed, null, at + ': never while typing');
    } else {
      assert.ok(VIA[h.via], at + ': a known handler'); assert.ok(VIA[h.via](h), at + ': ' + h.via + ' handles it');
    }
    n++;
  }
  assert.ok(n >= 40, n + ' presses checked');
});

await test('and the other way: every key keyAction handles is on the card (letters, digits, punctuation, Ctrl+arrows), with the same action', () => {
  const onCard = keyRows.flatMap((r) => r.hits.filter((h) => h.act).map((h) => ({ k: h.ctrl ? 'Ctrl+' + h.key : h.key, act: h.act })));
  const card = (k) => onCard.filter((x) => x.k === k);
  const keys = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?.,;\'[]\\-=`!@#$%^&*()_+{}|:"<>~', 'Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'F1'];
  const missing = [];
  for (const k of keys) {
    const a = GP.keyAction({ key: k });
    if (!a) continue;
    const hits = card(k).length ? card(k) : card(k.toLowerCase()).length && /^[A-Z]$/.test(k) && a.type !== 'blank' ? card(k.toLowerCase()) : [];
    if (!hits.some((x) => JSON.stringify(x.act) === JSON.stringify(a))) missing.push(k + ' ' + JSON.stringify(a));
  }
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const a = GP.keyAction({ key: k, ctrlKey: true });
    if (a && !card('Ctrl+' + k).some((x) => JSON.stringify(x.act) === JSON.stringify(a))) missing.push('Ctrl+' + k + ' ' + JSON.stringify(a));
  }
  assert.deepEqual(missing, [], 'keys the page handles that the card leaves out');
  assert.equal(GP.keyAction({ key: '?', typing: true }), null, '? typed in a field is the field\'s');
  assert.equal(GP.keyAction({ key: '?', ctrlKey: true }), null); assert.equal(GP.keyAction({ key: '?', altKey: true }), null);
});

await test('onKey: ? reaches keyAction only with nothing open over the page, and shuts the card when the card is the top box (a typed ? is never it)', () => {
  assert.ok(/else if \(a\.type === 'shortcuts'\) shortcutsToggle\(\);/.test(onKey), 'keyAction\'s shortcuts opens or shuts the card');
  const topAt = onKey.indexOf('var top = escTop();'), actAt = onKey.indexOf('var a = keyAction(');
  assert.ok(topAt > 0 && actAt > topAt, 'the top box is asked before any key acts');
  assert.ok(/!typing\(tg\) && !ev\.ctrlKey && !ev\.metaKey && !ev\.altKey && k0 === '\?' && top === 'sheet-' \+ SC_SHEET\) \{ ev\.preventDefault\(\); shortcutsToggle\(\); return; \}/.test(onKey), 'behind the card, ? shuts it');
  assert.ok(onKey.indexOf("if (findOn()) {") < topAt, 'with Find open, Find keeps its keys (? goes into its box)');
  assert.ok(/var SC_SHEET = 'shortcuts';/.test(SRC.page) && SC.SHEET === 'shortcuts', 'the sheet id the page asks for is the card\'s');
});

/* ---------- the markup ---------- */
await test('the markup: every row drawn in its section, keys as <kbd>, fill-ins as <var>, nothing unescaped; Find\'s row finds it by "keys", "commands", "help"', () => {
  const h = SC.html();
  for (const s of SC.SECTIONS) assert.ok(h.includes('data-sc-sec="' + s.id + '"'), s.id);
  assert.equal((h.match(/data-sc-row="/g) || []).length, SC.rows().length, 'one drawn row per row');
  assert.equal((h.match(/data-sc-row="say"/g) || []).length, sayRows.length);
  assert.ok(h.includes('<kbd>Ctrl K</kbd>') && h.includes('<kbd>?</kbd>') && h.includes('<kbd>Esc</kbd>'));
  assert.ok(h.includes('Blade, tick <var>Alarm</var> <var>two</var>'), 'a fill-in is a <var>');
  assert.ok(!/<(?!\/?(div|p|section|h3|dl|dt|dd|kbd|span|var|code|b)\b)[a-z]/i.test(h), 'only the card\'s own tags');
  assert.ok(!/[{}]/.test(h.replace(/<[^>]+>/g, '')), 'no { or } reaches the screen');
  assert.ok(h.includes('data-how="mic"') && (h.match(/class="gm-sc-or"/g) || []).length === sayRows.filter((r) => r.typed).length, 'the iPad-mic lines are marked, and each typed form is drawn after its line');
  assert.ok(h.includes('or type <code class="gm-sc-typed">/clock <var>6</var> <var>Alarm</var></code>'), 'a typed form, fill-ins and all');
  for (let c = 1; c <= SC.COLS; c++) assert.ok(h.includes('data-sc-col="' + c + '"'), 'stack ' + c);
  const f = SC.findEntry();
  assert.equal(f.title, 'Shortcuts'); assert.equal(f.kind, 'Tool');
  const hits = (q) => GP.findHits([{ kind: 'Place', title: 'Go to Before', text: 'before the night' }, { ...f, go: { t: 'shortcuts' } }], q, 10).filter((x) => x.go && x.go.t === 'shortcuts').length;
  for (const q of ['Shortcuts', 'short', 'keys', 'commands', 'help', 'cheat sheet', 'blade lines', 'clock']) assert.equal(hits(q), 1, 'Find "' + q + '"');
  assert.ok(/'shortcuts'\) shortcutsOpen\(\);/.test(SRC.page) && /out\.push\(Object\.assign\(W\.B68GmShortcuts\.findEntry\(\), \{ go: \{ t: 'shortcuts' \} \}\)\)/.test(SRC.page), 'the page puts it in Find and opens it from there');
  assert.ok(/data-gm="shortcuts" id="gm-menu-shortcuts"[^>]*>Shortcuts <kbd>\?<\/kbd><\/button>/.test(SRC.page) && /case 'shortcuts': menuOpen\(false\); shortcutsOpen\(\); break;/.test(SRC.page), 'and in the Menu');
});

/* ---------- the sheet: the Workshop's, so the one Esc closes it ---------- */
await test('the sheet: make(host) opens the card in the Workshop\'s right-edge sheet "shortcuts", draws it once, toggles, and the one Esc closes it (priority 50: no page key behind it)', () => {
  Esc.reset();
  globalThis.B68GmEsc = Esc;
  const Wk = require(app('gm', 'workshop.js'));
  globalThis.B68GmWorkshop = Wk;
  /* a fake document just big enough for the sheet */
  const mk = (doc, tag) => { const e = { tagName: tag.toUpperCase(), ownerDocument: doc, hidden: false, isConnected: true, attrs: {}, children: [], parentNode: null, listeners: {}, _html: '', className: '', id: '',
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k] ?? null; }, addEventListener(t, fn) { e.listeners[t] = fn; }, appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
    focus() { doc.activeElement = e; },
    set innerHTML(v) { e._html = v; if (/gm-sheet-body/.test(v)) { e.body = mk(doc, 'div'); e.body.className = 'gm-sheet-body'; } }, get innerHTML() { return e._html; },
    querySelector(sel) { if (sel === '.gm-sheet-body') return e.body; if (sel === '[data-sc]') return /data-sc[ >]/.test(e._html) ? {} : null; return null; } };
    return e; };
  const doc = { activeElement: null }; doc.createElement = (t) => mk(doc, t);
  const root = mk(doc, 'div');
  const card = SC.make({ root: () => root });
  assert.equal(card.isOpen(), false);
  assert.equal(card.open(), true); assert.equal(card.isOpen(), true);
  const sheet = root.children[0];
  assert.equal(sheet.id, 'gm-sheet-shortcuts'); assert.equal(sheet.attrs['aria-label'], 'Shortcuts');
  assert.ok(sheet.body.innerHTML.includes('data-sc-sec="keys"'), 'the card is drawn into the sheet');
  assert.ok(Esc.list().some((x) => x.id === 'sheet-shortcuts' && x.open && x.priority === 50), 'the sheet is the one Esc\'s, open, at 50 (escTop holds the page\'s keys)');
  assert.equal(Esc.anyOpen(), true);
  assert.equal(Esc.handle({ field: null, panic: () => assert.fail('no PANIC while the card is open') }), 'closed:sheet-shortcuts', 'Esc closes the card');
  assert.equal(card.isOpen(), false);
  assert.equal(card.toggle(), true); assert.equal(card.isOpen(), true); assert.equal(card.toggle(), false); assert.equal(card.isOpen(), false, '? toggles');
  assert.equal(SC.make({ root: () => null }).open(), false, 'no page root: nothing opens');
  delete globalThis.B68GmWorkshop; delete globalThis.B68GmEsc; Esc.reset();
});

await test('GM only: the gm bundle loads it before the page, and nothing a phone or the iPad loads names it', () => {
  const R = require(app('routes.js'));
  const B = (R && R.BUNDLES) || (globalThis.B68Load && globalThis.B68Load.BUNDLES);
  assert.ok(B && Array.isArray(B.gm), 'the bundles');
  const g = B.gm; assert.ok(g.indexOf('gm/shortcuts.js') >= 0 && g.indexOf('gm/shortcuts.js') < g.indexOf('gm-page.js'), 'in the gm bundle, before gm-page.js');
  for (const [name, files] of Object.entries(B)) if (name !== 'gm') assert.ok(!files.includes('gm/shortcuts.js'), name + ' does not load it');
  const disp = fs.readFileSync(app('display-page.js'), 'utf8');
  assert.ok(!/B68GmShortcuts|shortcuts\.js/.test(disp), 'the display page never names it');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
